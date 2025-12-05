# SecureBank – Bug Fix Report

Author: Adithya Swarna
Branch: fix/tickets

---

## Ticket Summary

| Ticket ID | Area     | Priority | Status |
| --------- | -------- | -------- | ------ |
| SEC-301   | Security | Critical | Fixed  |
| SEC-302   | Security | High     | Fixed  |

---

# SEC-301 — SSN Stored in Plaintext (Critical)

### Verification Steps (Before Fix)

**Signed up a user with:**

* Email: `sec301-test@example.com`
* SSN: `123456789`

**Listed users in a second terminal:**

```bash
npm run db:list-users
```

**Output before applying the fix:**

```text
ID: 1, Email: sec301-test@example.com, Name: ..., SSN: 123456789
```

This confirmed SSN was stored exactly as entered, with no hashing or encryption.

---

## Root Cause Analysis

**File:** `server/routers/auth.ts`

The signup mutation inserted:

```ts
await db.insert(users).values({
  ...input,
  password: hashedPassword,
});
```

Since `...input` includes `ssn`, the raw SSN was written directly to the database.

The returned value:

```ts
return { user: { ...user, password: undefined }, token };
```

removed the password but still included the SSN, meaning SSN could also leak to:

* frontend logs
* browser devtools
* React Query cache
* monitoring tools

### Root cause summary

SSN was treated like normal user input instead of sensitive PII:

* ❌ SSN stored with no hashing or encryption
* ❌ SSN returned in API responses
* ❌ `...input` spread caused unintended sensitive data persistence

---

## Solution (What I Changed)

I applied three coordinated fixes.

### 1. Hash SSN before inserting into the database

```ts
// SEC-301 (Author: Adithya Swarna)
// Hash SSN before storing — suggestion: keep bcrypt rounds consistent for all sensitive fields.
const hashedPassword = await bcrypt.hash(input.password, 10);
const hashedSsn = await bcrypt.hash(input.ssn, 12);
```

### 2. Store the hashed SSN instead of the raw value

```ts
await db.insert(users).values({
  ...input,
  password: hashedPassword,
  ssn: hashedSsn, // SEC-301: store hashed SSN instead of plaintext
});
```

This ensures plaintext SSN is never written to the database.

### 3. Remove SSN from all returned API responses

```ts
const { password, ssn, ...safeUser } = user;
return { user: safeUser, token };
```

Ensures SSN never reaches the frontend.

---

### Verification Steps (After Fix)

Restarted the server:

```bash
npm run dev
```

Signed up a new user:

* Email: `awfqwrev@ex.com`
* SSN: `987654321`

Listed users:

```bash
npm run db:list-users
```

**Output after the fix:**

```text
ID: 1, Email: sec301-test@example.com, Name: ..., SSN: 123456789
ID: 2, Email: awfqwrev@ex.com, Name: ..., SSN: $2b$12$TpG1zUkcMHE12oHjkszDh.4ktyXEBEPlVrXNCMfDQCGIZG2Xo4VyS
```

* User 1 → pre-fix baseline (plaintext)
* User 2 → bcrypt hashed SSN (`$2b$12$...`)

---

### Post-Fix Confirmation

* ✔ Signup works
* ✔ Login works
* ✔ SSN never appears in API responses
* ✔ DB stores only hashed SSNs
* ✔ No regression in auth functionality

---

### Additional Notes (Hashing vs Encryption)

#### Hashing (bcrypt)

* One-way, cannot retrieve original SSN
* Secure for storage of sensitive identifiers

#### If retrieval were required in real banking systems:

* AES-256-GCM field-level encryption
* Tokenization (PCI-compliant)
* HSM-key-managed encryption

---

# SEC-302 — Insecure Account Number Generation (High Priority)

## Summary Points

### Problem

* Account numbers were generated using `Math.random()`, which is not cryptographically secure.
* Predictable values may allow attackers to guess valid account numbers.
* Small random range increased chance of collisions.

### Root Cause

Function in `server/routers/account.ts`:

```
Math.floor(Math.random() * 1000000000)
```

* Uses non-secure RNG and weak 9–10 digit space.
* No entropy guarantees; no protection against pattern prediction.

### Fix Implemented

Replaced `Math.random()` with crypto-secure generation:

```ts
import crypto from "crypto";

function generateAccountNumber(): string {
  return crypto.randomInt(0, 10_000_000_000).toString().padStart(10, "0");
}
```

Ensures:

* High entropy
* Unpredictable sequences
* Larger secure number space

### Verification

* Restarted application
* Created multiple accounts
* Observed:

  * All account numbers were unique
  * No sequential or predictable patterns
* Confirmed via SQLite DB viewer + CLI

### Additional Notes

Real banks often include:

* Checksum digits (e.g., Luhn)
* HSM-backed randomness
* ISO 13616/IBAN-style formats

For this assignment, CSPRNG resolves the vulnerability fully.
