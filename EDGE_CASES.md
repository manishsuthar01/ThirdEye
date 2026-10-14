# ThirdEye Distributed System Edge Cases & Production Engineering Guide

This document catalogs advanced distributed systems challenges, failure modes, and edge cases relevant to the **ThirdEye** architecture (Monorepo, Next.js frontend, Node.js API, RabbitMQ message broker with DLQ, and async background workers). 

Use this as a study guide for system design interviews and architectural deep-dives.

---

## Table of Contents
1. [Idempotency & Worker Retries](#1-idempotency--worker-retries)
2. [Backpressure & Flow Control in RabbitMQ](#2-backpressure--flow-control-in-rabbitmq)
3. [Rate Limiting & External API Constraints (GitHub API)](#3-rate-limiting--external-api-constraints-github-api)
4. [Large Payload Handling & Memory Management](#4-large-payload-handling--memory-management)
5. [Dead Letter Queue (DLQ) Poison Message Handling](#5-dead-letter-queue-dlq-poison-message-handling)
6. [Distributed Tracing & Observability](#6-distributed-tracing--observability)

---

### 1. Idempotency & Worker Retries

#### The Problem
In an asynchronous message-driven architecture, messages can be delivered **at-least-once**. If a worker processes a commit analysis task, updates the database, but crashes *just before* acknowledging (`ack`) the message to RabbitMQ, the message is re-queued. The worker will process the same commit a second time. This can cause duplicate records, double-billing, or corrupted state.

#### How Real Teams Handle It
*   **Idempotency Keys:** Every incoming message carries a unique correlation ID (e.g., `commit_sha + repo_id`).
*   **Database Constraints:** Use unique indexes/constraints (`UNIQUE(repo_id, commit_sha)`) combined with `UPSERT` (`INSERT ... ON CONFLICT DO UPDATE`) semantics.
*   **State Machines:** Check the entity's current status before processing (e.g., if status is already `ANALYZED`, skip or return early).

#### Learning Resources & References
*   [Stripe Engineering: Idempotent Requests](https://stripe.com/blog/idempotency) — The gold standard article on designing idempotent APIs and systems.
*   [AWS Architecture Blog: Handling Idempotency](https://aws.amazon.com/blogs/compute/operating-lambda-poll-based-event-sources-handling-idempotency/)

---

### 2. Backpressure & Flow Control in RabbitMQ

#### The Problem
If your API receives a sudden surge of 50,000 repository webhook events, it dumps them all into RabbitMQ. If your background workers consume messages faster than they can process them (or if database writes become a bottleneck), the workers will run out of memory (OOM crash) or flood the database connection pool.

#### How Real Teams Handle It
*   **Consumer Prefetch Count (`basic.qos`):** Limit the number of unacknowledged messages a worker can hold in memory at once (e.g., `channel.prefetch(10)`). This prevents a fast broker from overwhelming a slow worker.
*   **Lazy Queues:** Configure RabbitMQ queues to push messages directly to disk rather than keeping them all in RAM, preventing broker OOM during traffic spikes.
*   **Circuit Breakers:** If the database or downstream APIs start throwing errors, the worker stops pulling messages from the queue temporarily to let the downstream system recover.

#### Learning Resources & References
*   [RabbitMQ Documentation: Consumer Concurrency and Prefetch](https://www.rabbitmq.com/docs/confirms#channel-qos)
*   [The Twelve-Factor App: Disposability (Fast startup and graceful shutdown)](https://12factor.net/disposability)

---

### 3. Rate Limiting & External API Constraints (GitHub API)

#### The Problem
If ThirdEye fetches commit diffs and metadata directly from the GitHub REST/GraphQL API, it will quickly hit secondary and primary rate limits (e.g., 5,000 requests per hour for authenticated requests), causing analysis jobs to fail.

#### How Real Teams Handle It
*   **Token Bucket / Leaky Bucket Algorithms:** Implement rate-limiting proxies or client-side throttling wrappers around external API calls.
*   **Distributed Rate Limiting (Redis):** Share rate limit counters across multiple API and worker instances using Redis.
*   **Conditional Requests (`ETags`):** Cache API responses using HTTP ETags or `If-Modified-Since` headers to avoid consuming quota when data hasn't changed.

#### Learning Resources & References
*   [GitHub REST API Documentation: Rate Limiting](https://docs.github.com/en/rest/overview/rate-limits-for-the-rest-api)
*   [Stripe Engineering: Rate Limiters](https://stripe.com/blog/rate-limiters)

---

### 4. Large Payload Handling & Memory Management

#### The Problem
Passing massive diffs (e.g., a commit changing 10,000 files or a 50MB binary patch) directly inside a RabbitMQ message payload will bloat the broker, consume excessive network bandwidth, and crash Node.js workers due to V8 heap limits (`ERR_STRING_TOO_LONG` or out-of-memory).

#### How Real Teams Handle It
*   **Claim-Check Pattern (Reference Passing):** Instead of putting large payloads in the message, upload the raw file/diff to object storage (e.g., AWS S3, MinIO) and pass only the storage URI/pointer in the queue message.
*   **Stream Processing:** Process large payloads using Node.js Streams (`stream.pipeline`) rather than loading the entire file into memory as a string or buffer.

#### Learning Resources & References
*   [Enterprise Integration Patterns: Claim Check](https://www.enterpriseintegrationpatterns.com/patterns/messaging/ClaimCheck.html)
*   [Node.js Documentation: Stream API](https://nodejs.org/api/stream.html)

---

### 5. Dead Letter Queue (DLQ) Poison Message Handling

#### The Problem
A "poison message" is a message that consistently causes a worker to crash or throw an unhandled exception (e.g., parsing a malformed commit diff that throws a syntax error). Without a DLQ, the broker will redeliver the message infinitely (infinite loop / retry storm), choking the worker queue.

#### How Real Teams Handle It
*   **Dead Letter Exchanges (DLX):** Configure RabbitMQ so that messages rejected with `requeue: false` or messages exceeding a `x-max-retries` threshold are automatically routed to a DLQ.
*   **Alerting & Inspection Dashboards:** Build or use monitoring tools to alert engineers when messages land in the DLQ, allowing manual inspection and code fixes before re-injecting them.

#### Learning Resources & References
*   [RabbitMQ Documentation: Dead Letter Exchanges](https://www.rabbitmq.com/docs/dlx)
*   [AWS: DLQ Best Practices](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html)

---

### 6. Distributed Tracing & Observability

#### The Problem
When a request comes into the Next.js frontend, hits the API, is published to RabbitMQ, consumed by a background worker, and saved to the database, how do you debug a failure? Traditional logging (`console.log`) across disjointed services leaves you blind.

#### How Real Teams Handle It
*   **Correlation IDs / W3C Trace Context:** Generate a unique `trace_id` at the API entry point and pass it through HTTP headers and RabbitMQ message headers (`properties.headers`).
*   **Structured Logging (JSON):** Output logs in JSON format with fields like `timestamp`, `level`, `trace_id`, `repo_id`, and `event`.
*   **Centralized Aggregation:** Ship logs to systems like Elasticsearch/Kibana, Grafana Loki, or Datadog.

#### Learning Resources & References
*   [OpenTelemetry Documentation](https://opentelemetry.io/)
*   [Google Cloud: Distributed Tracing Concepts](https://cloud.google.com/trace/docs/overview)
