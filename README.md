# ⚡ BotWorks Command Center

[![Node.js 20](https://img.shields.io/badge/Node.js-20.x%20LTS-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Discord.js v14](https://img.shields.io/badge/Discord.js-v14.17-5865F2?logo=discord&logoColor=white)](https://discord.js.org/)
[![Database SQLite](https://img.shields.io/badge/Database-better--sqlite3-003B57?logo=sqlite&logoColor=white)](https://github.com/WiseLibs/better-sqlite3)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](LICENSE)
[![Hosting](https://img.shields.io/badge/Hosting-Pterodactyl%20%2F%20SparkedHost-orange)](https://sparkedhost.com/)

> **Autonomous All-in-One Internal Agency Operations & Client Sentinel Bot for BotWorks AI.**

**BotWorks Command Center** is a production-grade Discord.js (v14) bot engineered to autonomously manage agency prospecting, client onboarding, sales pipeline tracking, and 24/7 cloud hosting telemetry. Designed for high availability on Node.js 20 within Pterodactyl / Sparked Host panel environments.

---

### 🚀 Key Features

* **🎯 Autonomous Lead Scout Engine:**
  * Multi-directory scraping across Disboard, Discadia, and DiscordServers with rotating User-Agents.
  * Strict SQLite deduplication preventing duplicate server pitches.
  * Curated fallback seed pools ensuring high-yield prospecting across FiveM, Reselling, Roblox, and Creative agency verticals.

* **📋 Dynamic Pitch Generator:**
  * Automated 3-point value proposition engine citing standard flat **$15 build + $5/mo hosting** pricing models.
  * Interactive Discord action rows with instant join links, ephemeral pitch viewers, and CRM status updates.

* **🛡️ Sparked Host & Stripe Billing Sentinel:**
  * Live server UUID tracking linked directly to Sparked Host Pterodactyl startup consoles.
  * Automated payment status monitoring (`Active`, `Past Due`, `Cancelled`) and hosting MRR calculation.
  * **Automatic Customer Reminders:** Instantly dispatches polite direct messages containing secure Stripe renewal links when an account is marked Past Due.

* **💎 Invoicing & Role Lifecycle Automation:**
  * `/payment_link`: Generates branded $15 custom build invoice cards equipped with Stripe checkout buttons and terms.
  * Automated server role management: Automatically assigns `@Active Order` on invoice issuance, upgrades to `@Verified Customer` upon deployment, and clears active tickets.

* **🌐 Embedded Express Server:**
  * Built-in HTTP listener for Stripe subscription webhooks (`invoice.payment_failed`, `customer.subscription.deleted`, `invoice.payment_succeeded`).
  * Continuous health ping endpoints (`/` and `/health`) for uptime monitors and Pterodactyl container health telemetry.

---

### 🛠️ Tech Stack

* **Runtime:** Node.js 20 LTS
* **Discord Library:** Discord.js v14
* **Database:** `better-sqlite3` (WAL Mode enabled for non-blocking concurrent queries)
* **Web Framework:** Express.js
* **Scraping Engine:** Axios + Cheerio
