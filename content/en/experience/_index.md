+++
title = 'Experience'
draft = false
date = '2026-04-05'

intro = "A summary of my professional experience and key accomplishments."

resume_label = "Download Resume"

[[resume_downloads]]
  lang = "en"
  label = "English"

[[positions]]
  company = "Flix"
  company_url = "https://www.flixbus.com/"
  role = "Senior Java Developer"
  period = "Dec 2021 – Present"
  industry = "Technology"
  location = "Warsaw, Poland"
  bullet_points = [
      "Built internal customer service platform replacing legacy monolith; developed backend services and UI components",
      "Migrated high-traffic services from Spring MVC to WebFlux, reducing resource consumption ~40%",
     " Replaced RabbitMQ with Kafka (30K+ msg/min); decomposed domains into 12+ bounded-context services",
      "Built REST APIs + OpenSearch integration achieving sub-200ms p95 latency on order/booking search",
      "Implemented CQRS/Event Sourcing (Axon Framework) for train assignments — MySQL event store + MongoDB read projections; enabled regulatory audit trail, independent scaling, and multi-version API support",
      "Provisioned AWS infra with Terraform; deployed to Kubernetes via GitOps (Argo CD); leveraged AI-assisted development (Claude Code, Cursor,      Copilot) for faster prototyping and code generation",
      "Implemented Datadog SLI/SLO dashboards, reducing mean incident response time ~50%",
  ]

[[positions]]
  company = "bSafe"
  company_url = "https://www.getbsafe.com/"
  role = "Senior Java Developer"
  period = "Feb 2021 – Dec 2021"
  industry = "Finance"
    location = "Kharkiv, Ukraine"
  bullet_points = [
      "Migrated monolith to microservices, decomposing 4 core domains by bounded context into independently deployable services",
      "Introduced async messaging (SQS/SNS), reducing inter-service latency ~60% and decoupling 3 critical workflows",
      "Implemented IaC (Terraform, 15+ managed resources); built serverless workflows (Lambda, API Gateway)",
  ]

[[positions]]
  company = "CHI Software"
  company_url = "https://chisw.com/"
  role = "Senior Java Developer"
  period = "May 2018 – Feb 2021"
  location = "Kharkiv, Ukraine"
  bullet_points = [
      "Designed event-driven inter-service communication for medical data processing, handling 10K+ lab results/day",
      "Developed microservices with Spring Boot and Kafka Streams for real-time container tracking across 20+ ports",
      "Built event-sourced audit trail for container movements, enabling compliance reporting and dispute resolution",
      "Implemented Azure AD (Entra ID) SSO using OAuth 2.0/OIDC and JWT, securing multi-tenant access for 50+ clients",
      
  ]
+++
