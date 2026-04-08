+++
title = 'Kafka + Postgres: 7 Ways Your System Corrupts Data and How to Fix It'
description = 'Seven failure modes when turning Kafka events into database state and how to design for them. Idempotency, transactional outbox, deduplication and more.'
date = '2026-04-08'
tags = ['kafka', 'postgres', 'event-driven', 'distributed-systems']
type = 'blog'
+++

You’ve built the service. Events flow through Apache Kafka. State lands in PostgreSQL. Everything looks correct.

Then one Thursday at 3 PM, a customer gets charged twice. On Friday, an order disappears.
By Monday, two services disagree on reality and nobody can explain why.

None of these are Kafka bugs. None of them are Postgres bugs. They’re design bugs.

They live in the gap between “message received” and “state persisted” a gap most systems treat as trivial until production proves otherwise.

This article breaks down seven failure modes I’ve seen when turning Kafka events into database state. Each one looks harmless in development but fails under retries, concurrency or reprocessing.

{{< callout type="takeaway" title="Why this matters" >}}
If you’re building event-driven systems, this isn’t theory. It’s the set of problems you either design for or debug at 3 AM.
{{< /callout >}}

---

## 1. The Duplicate That Became a Real Charge

### The scene

Your payment service processes a `PaymentReceived` event. It inserts a row into `transactions`. Everything works — until a consumer rebalance happens mid-commit.

Kafka never receives the offset acknowledgment.
The message is delivered again.

Now your customer has two identical charges.

### Why it happens

Kafka guarantees **at-least-once** delivery. Not exactly-once. Not "probably once." **At-least-once.**

That means every message you consume *will* arrive again someday after:

- a consumer rebalance
- a crash or restart
- a network hiccup
- a deploy

The question isn't *if* duplicates happen. It's *when*.

{{< callout type="takeaway" title="Why this matters" >}}
The goal isn't to prevent duplicates. You can't. The goal is to make them **harmless**.
{{< /callout >}}

### The Solution — Idempotent Consumers



There are two techniques that work reliably in production.

#### Technique 1 — Deduplication table

Every event carries a unique `event_id`. Before processing, check whether it has already been handled.

```sql
CREATE TABLE processed_events (
    event_id UUID PRIMARY KEY,
    processed_at TIMESTAMPTZ DEFAULT now()
);

-- Inside your consumer's transaction:
INSERT INTO processed_events (event_id) VALUES ('abc-123');
-- If this throws a unique violation → skip the message

INSERT INTO transactions (id, amount, ...) VALUES (...);
```

Both statements live inside the **same Postgres transaction**.
Either both succeed, or neither does. No partial state. No double charge.

#### Technique 2 — UPSERT (natural idempotency)

If your operation is *"set the balance to X"* rather than *"add X to the balance,"* you don't need a dedup table at all. Use `ON CONFLICT`:

```sql
INSERT INTO account_balances (account_id, balance, updated_at)
VALUES ('acc-42', 1500.00, '2025-01-15T10:00:00Z')
ON CONFLICT (account_id)
DO UPDATE SET
    balance = EXCLUDED.balance,
    updated_at = EXCLUDED.updated_at
WHERE account_balances.updated_at < EXCLUDED.updated_at;
```

Notice the `WHERE` clause — it only updates if the incoming event is **newer** than what's already stored. That single line prevents stale events from overwriting fresh state.

(This matters more than you'd think — see section 4.)

### Takeaway

> **Don't try to prevent duplicates. Make them harmless.**

---

## 2. The Update That Disappeared

**The scene:** Two instances of your `inventory-service` consume events from the `stock-updates` topic. Both receive events for the same product within milliseconds. Consumer A reads the current stock as 100, subtracts 3, writes 97. Consumer B read the same 100, subtracts 5, writes 95. The correct answer was 92. You just created 3 phantom units of inventory.

**Why it happens:** Kafka partitions give you ordering guarantees *per partition*. But if two events for the same entity land on different partitions — or if you're running multiple consumers on the same partition group with concurrent DB access — you've got a classic lost-update race condition.

{{< callout type="danger" title="Why this matters" >}}
If two consumers can update the same row at the same time, you don’t have a distributed system - you have a race condition generator.
{{< /callout >}}

**The Solution: Partition Key Design**

Route all events for the same entity to the same partition. Same partition → same consumer in the group → serialized processing. No race.

```java
// Produce with entity key
producer.send(new ProducerRecord<>(
    "stock-updates",
    product.getId(),   // partition key = product ID
    stockUpdateEvent
));
```

Now every stock update for `product-42` hits the same partition, gets consumed by the same instance, in order.

{{< callout type="warning" title="But know the limits" >}}
- **Cross-entity operations** (e.g., "transfer stock from warehouse A to B") span multiple keys. Kafka won't serialize those for you. You need saga patterns or database-level coordination.
- **Hot partitions.** If one product gets 80% of all events, one consumer does 80% of the work. Your scaling model is broken. Consider compound keys or a separate fast-path for high-volume entities.
- **External writers.** If another service writes to the same Postgres table directly (not through Kafka), your partition-based ordering means nothing. The database is now a shared mutable state with two unsynchronized writers.
{{< /callout >}}

> **Takeaway:** Kafka gives you ordering per key. The database must still enforce correctness.

---

## 3. The Order That Never Happened

**The scene:** Your service receives a `PlaceOrder` event. It inserts the order into Postgres, then publishes an `OrderCreated` event to Kafka for downstream services. The DB write succeeds. The Kafka publish fails — network timeout. Now the order exists in your database, but nobody downstream knows about it. No invoice. No shipping. A ghost order.

Flip the order? Publish first, then write? Now Kafka has the event but your DB doesn't. Equally broken.

**Why it happens:** You're doing a *dual write* — two systems that need to agree, with no shared transaction. Postgres transactions don't span Kafka. Kafka transactions don't span Postgres. There is no atomic operation that covers both.

{{< callout type="danger">}}
Dual writes don’t fail loudly. They fail silently—and that’s what makes them dangerous.
{{< /callout >}}


{{< callout type="takeaway" title="Hint" >}}
Write to one system — and make it the source of truth.
{{< /callout >}}
**The Solution: Transactional Outbox**

Stop trying to write to two systems. Write to one — Postgres — and let the second system catch up.

```sql
-- Single Postgres transaction
BEGIN;

INSERT INTO orders (id, customer_id, total, status)
VALUES ('order-99', 'cust-7', 250.00, 'PLACED');

INSERT INTO outbox_events (id, aggregate_type, aggregate_id, event_type, payload)
VALUES (
    gen_random_uuid(), 'Order', 'order-99', 'OrderCreated',
    '{"orderId": "order-99", "customerId": "cust-7", "total": 250.00}'
);

COMMIT;
```

A separate process (Debezium CDC on the outbox table, or a polling publisher) reads from `outbox_events` and pushes to Kafka. If it fails, it retries. The source of truth — Postgres — is always consistent.

{{< callout type="warning" title="The trade-offs are real" >}}
- **Eventual consistency.** Downstream services see the event seconds (or minutes, during an outage) after the DB write. If your system assumes synchronous propagation, you'll need to redesign those assumptions.
- **Operational overhead.** You now have a CDC connector or a polling job to monitor, alert on, and debug when it stalls.
- **Extra table, extra writes.** Every state change means an additional insert. Under high throughput, the outbox table needs its own cleanup and indexing strategy.
{{< /callout >}}

But compared to "orders that silently vanish from half your system" — it's a bargain.

> **Takeaway:** Don't make Kafka transactional. Make Postgres the only transaction.

---

## 4. The Event From the Future (That Arrived Before the Past)

**The scene:** Your service consumes `UserUpdated` events. The user changes their email at 10:00:01 and their name at 10:00:02. Due to a producer retry or partition rebalance, the name-change event arrives first. You apply it. Then the email-change event arrives — with older data for every other field. You overwrite the new name with the old one. The user's name change is silently lost.

**Why it happens:** Kafka guarantees ordering *within a partition*. But producer retries, multiple producer instances, or cross-partition scenarios can deliver events out of logical order. And even within a partition, if your producer sends two rapid-fire updates with slightly different timing, infrastructure hiccups can reorder them.

Arrival order ≠ causality.

**The Solution: Version-Based Application**

Every event carries a version number (or a timestamp that acts as one). The consumer only applies the event if it's newer than what's currently stored.

```sql
UPDATE users
SET 
    email = 'new@example.com',
    version = 42
WHERE id = 'user-7'
  AND version < 42;  -- Only apply if we haven't seen this version or a newer one
```

If the `WHERE` clause matches zero rows, the event is stale — drop it silently. No error. No retry. It's just old news.

{{< callout type="warning" title="Where this gets hard" >}}
- **You need a version source of truth.** Who assigns version numbers? If it's the producer, multiple producers can collide. If it's a central sequence, you've added a bottleneck. Timestamps work if clocks are synchronized (they're often not).
- **Partial updates.** If event v42 updates the email and event v43 updates the name, applying v43 first and then rejecting v42 means the email change is lost forever. You may need per-field versioning or event-carried state transfer (each event carries the full entity state).
{{< /callout >}}


There's no free lunch here — just trade-offs you choose consciously.

> **Takeaways:** Ordering is not guaranteed by Kafka. It’s enforced by your data model. If your state depends on arrival order, it’s already wrong.

---

## 5. The Replay That Corrupted Production

**The scene:** A bug in your billing service miscalculated taxes for two weeks. The fix is simple — patch the code and replay the events. You reset the consumer offsets to two weeks ago and restart. The replayed events have older versions than the current data. Your version checks (from section 4) reject them all. Nothing gets recalculated.

So you disable version checks. Now the replay works — but it also overwrites two weeks of *correct* data that came after the buggy period, because the events carry their original timestamps.

**Why it happens:** Reprocessing and live consumption are fundamentally different operations. Live consumption builds state forward incrementally. Reprocessing recomputes state from scratch. Mixing them — replaying old events into the same tables that serve live traffic — creates conflicts that no amount of clever versioning can resolve.

{{< callout type="warning" title="Where this gets hard" >}}
Versioning protects live systems. It actively prevents reprocessing.
{{< /callout >}}

**The Solution: Rebuild Into a New Projection**

{{< callout type="takeaway" title="Hint" >}}
Treat reprocessing as what it is: a *new computation*, not a continuation of the old one.
{{< /callout >}}


```
-- Live state
billing_line_items          ← current consumers write here

-- Reprocessed state (new table or schema)
billing_line_items_v2       ← replay consumers write here

-- Once validated, swap
ALTER TABLE billing_line_items RENAME TO billing_line_items_old;
ALTER TABLE billing_line_items_v2 RENAME TO billing_line_items;
```

The replay writes into a parallel projection. You validate the results. Then you swap — atomically, with zero interference to the live pipeline.

{{< callout type="warning" title="The trade-offs are real" >}}
- **Double storage** during the rebuild window.
- **Migration complexity.** If downstream services reference the table directly, the swap needs coordination.
- **Time.** Rebuilding two weeks of events takes time. You need a strategy for what happens to new events that arrive during the rebuild.
{{< /callout >}}

But this is the only approach that lets you reprocess safely without gambling your production state.

> **Takeaway:** Never replay into the same state. Rebuild into a new one.

---

## 6. The Customer Who Got Charged Twice During a Replay

**The scene:** You're replaying events to rebuild your order projections (following the advice from section 5, like a responsible engineer). The replay processes a `PaymentApproved` event. Your consumer's downstream logic triggers a webhook to the payment provider: "Capture this payment." Congratulations — you just charged a real customer for a six-month-old order. Again.

**Why it happens:** Event processing often triggers side effects: HTTP calls to payment providers, email sends, SMS notifications, shipment initiations. These are real-world actions that *cannot be undone by replaying a compensating event*. State is replayable. Side effects are not.

{{< callout type="takeaway" title="Hint" >}}
Side effects must be idempotent, logged, and isolated from replay.
{{< /callout >}}

**The Solution: A Layered Defense**

In practice, you need multiple mechanisms working together:

**1. Idempotency keys for external calls.**

```java
// The idempotency key is derived from the event, not generated fresh
String idempotencyKey = "payment-capture-" + event.getOrderId() + "-" + event.getEventId();
paymentProvider.capture(amount, idempotencyKey);
// Stripe, Adyen, etc. will recognize the duplicate and return the original result
```

**2. Side-effect log in Postgres.**

```sql
-- Check before executing
SELECT 1 FROM executed_side_effects 
WHERE effect_key = 'email-order-confirmation-order-99';

-- If not found, execute and log (in one transaction with your state update)
INSERT INTO executed_side_effects (effect_key, executed_at)
VALUES ('email-order-confirmation-order-99', now());
```

**3. Replay mode flag.** During reprocessing, disable all side effects entirely:

```java
if (consumerContext.isReplayMode()) {
    log.info("Replay mode: skipping payment capture for order {}", orderId);
    return;
}
```

This is the bluntest instrument — but during a bulk replay, it's the safest.

**4. Route side effects through the outbox** (from section 3). If side effects are only triggered by the outbox publisher, and you don't replay the outbox during rebuilds, side effects simply don't fire.

> **Takeaway:** Reprocessing is a test of your system. Side effects are where it fails.

---

## 7. The Myth of Exactly-Once (and What to Build Instead)

**The scene:** A team lead asks in a design review: "Can we guarantee the customer gets exactly one confirmation email?" The honest answer is no. Not across distributed systems. Not when your service, Kafka, Postgres, the email provider, and the network between them can each fail independently.

**Why it's impossible:** For a side effect to be guaranteed exactly-once across distributed systems, you'd need an atomic transaction spanning Kafka, Postgres, and every external system involved. That transaction doesn't exist. It *can't* exist — this is a consequence of the fundamental constraints of distributed computing, not a limitation of your tooling.

{{< callout type="warning" >}}
If your system depends on exactly-once, it’s not fault-tolerant—it’s lucky.
{{< /callout >}}


**What to build instead: Effectively-Once Semantics**

The industry pattern — used by Stripe, Shopify, and virtually every payment system at scale — is: **at-least-once delivery + idempotency + retry = effectively-once behavior.**

The building blocks are everything from sections 1–6, assembled together:

| Layer | Mechanism | Protects Against |
|-------|-----------|-----------------|
| Kafka Consumer | Dedup table / idempotent writes | Duplicate processing |
| Partition Design | Key-based routing | Concurrent mutation |
| State Persistence | Transactional outbox | Dual write inconsistency |
| Event Application | Version checks | Out-of-order corruption |
| Reprocessing | Parallel projections | Replay-induced data loss |
| Side Effects | Idempotency keys + effect logs | Duplicate real-world actions |

The result: the system *behaves* as if each event is processed exactly once — even though the underlying mechanics are "process at least once, but make repeats harmless."

{{< callout type="takeaway" title="Hint" >}}
Design systems where duplication doesn’t matter.
{{< /callout >}}

This isn't a workaround. This *is* the architecture. Every reliable event-driven system you've used as a customer (payments, e-commerce, logistics) works this way under the hood.

> **Takeaway:** Exactly-once is a myth. Effectively-once is engineering.

---

## Closing: The Mental Model

If there's one thing to take from this article, it's this: 

{{< callout type="takeaway" title="Hint" >}}
**The failure modes between Kafka and Postgres are not edge cases. They are the default behavior.**
{{< /callout >}}

At-least-once delivery means duplicates. Concurrent consumers mean races. Two systems mean split-brain. Network means reordering. Replay means ghosts.

The systems that handle this well don't do anything exotic. They do the boring things — dedup tables, outbox patterns, version checks, idempotency keys — consistently and everywhere.

The gap between "it works on my machine" and "it works in production at 3 AM during a rebalance" is exactly these seven patterns.

Build for the rebalance.

---

*If this was useful, I write about backend architecture, Kafka, and distributed systems patterns. Follow for more.*
