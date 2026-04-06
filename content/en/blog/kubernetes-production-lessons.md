+++
title = 'Kubernetes in Production: What I Wish I Knew Earlier'
description = 'A candid look at the pitfalls and best practices for running Kubernetes in production. From resource limits to pod disruption budgets, these are the things that caught us off guard.'
date = '2026-02-20'
tags = ['kubernetes', 'devops', 'cloud']
type = 'blog'
+++

Kubernetes is a powerful platform, but running it in production comes with a learning curve that documentation alone won't prepare you for. Here are the lessons that would have saved us many late-night incidents.

## Set Resource Requests and Limits — Always

Without proper resource requests, the scheduler can't make good placement decisions. Without limits, a single runaway pod can starve its neighbors. We learned this the hard way when a memory leak in one service caused cascading OOM kills across the node.

## Pod Disruption Budgets Are Not Optional

Rolling updates and node drains can take down too many replicas at once if you don't configure PodDisruptionBudgets. For any service that needs high availability, set a `minAvailable` or `maxUnavailable` policy.

## Liveness vs. Readiness Probes

Misconfiguring probes is one of the most common Kubernetes mistakes. A liveness probe that's too aggressive will restart healthy pods under load. A missing readiness probe will send traffic to pods that aren't ready to serve.

## Invest in Observability

We standardized on Prometheus for metrics, Grafana for dashboards, and Jaeger for distributed tracing. Having these in place before issues arise is critical — you can't debug what you can't see.

## Final Thoughts

Kubernetes rewards careful configuration and punishes assumptions. Take the time to understand the abstractions, set sensible defaults, and always test failure scenarios before they find you.
