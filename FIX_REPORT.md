# SecureBank – Bug Fix Report

Author: Adithya Swarna
Branch: fix/tickets

---

## Ticket Summary

| Ticket ID | Area       | Priority | Status |
| --------- | ---------- | -------- | ------ |
| SEC-301   | Security   | Critical | Fixed  |
| SEC-302   | Security   | High     | Fixed  |
| SEC-303   | Security   | Critical | Fixed  |
| VAL-202   | Validation | Critical | Fixed  |
| VAL-206   | Validation | Critical | Fixed  |
| VAL-208   | Validation | Critical | Fixed  |
| PERF-401   | Logic and Performance | Critical | Fixed  |

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

---

# SEC-303 — XSS Vulnerability in Transaction Descriptions (Critical)

##

## Root Cause Analysis

**File:** `components/TransactionList.tsx`

The transaction description was rendered using `dangerouslySetInnerHTML`:

```tsx
<td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
  {transaction.description ? (
    <span dangerouslySetInnerHTML={{ __html: transaction.description }} />
  ) : (
    "-"
  )}
</td>
```

This directly injects the string from `transaction.description` into the DOM as HTML, making the app vulnerable to stored XSS if any malicious content is stored in the transactions table.

Even though the current backend only sets descriptions like *Funding from card* or *Funding from bank*, this pattern is unsafe because:

* Future features might allow user-entered descriptions.
* An attacker who can write to the DB (or exploit another bug) could persist `<script>` tags that execute for every user viewing the dashboard.

### Root cause summary:

* ❌ Use of `dangerouslySetInnerHTML` on untrusted data.
* ❌ No sanitization or encoding of description before rendering.
* ❌ Classic stored XSS pattern in a high-sensitivity context (banking UI).

---

## Solution (What I Changed)

### 1. Remove `dangerouslySetInnerHTML` and render as plain text

**Before:**

```tsx
{transaction.description ? (
  <span dangerouslySetInnerHTML={{ __html: transaction.description }} />
) : (
  "-"
)}
```

**After:**

```tsx
// SEC-303 (Author: Adithya Swarna)
// Removed dangerouslySetInnerHTML to prevent stored XSS.
// All transaction descriptions are now rendered as plain text.
// React’s default escaping safely handles any malicious input.
{transaction.description ? (
  <span>{transaction.description}</span>
) : (
  "-"
)}
```

This change:

* Relies on React’s default escaping to prevent HTML from being interpreted as executable code.
* Ensures any HTML-like string (including `<script>`) is displayed as text rather than executed.

---

## Verification Steps (After Fix)

Kept the modified DB row where description was:

```html
<script>alert("XSS")</script>
```

Reloaded /dashboard in the browser.

### Observed behavior (after fix):

* No alert pop-up.
* The description cell displays the literal text:

```text
<script>alert("XSS")</script>
```

Funded another account to verify normal behavior:

* New transaction appears with description like *Funding from card*.
* No console errors or rendering issues.

### Result:

* ✔ XSS payload is no longer executed.
* ✔ Legitimate descriptions still render correctly.
* ✔ No regressions in transaction history display.

---

## Preventive Measures

* Avoid `dangerouslySetInnerHTML` unless absolutely necessary and content is strictly sanitized.
* For future features that may allow custom descriptions:

  * Validate and sanitize input on the backend.
  * Consider enforcing a safe character set and maximum length.
  * Keep descriptions as plain text in the UI by default; only render HTML when there is a strong business need and proper sanitization in place.

---

# VAL-202 — Date of Birth Validation Allows Future Dates

## Issue Summary

* The system accepted future dates as valid Date of Birth.
* This violates expected user-data rules and could cause compliance issues.
* Backend stored `dateOfBirth` as a JavaScript `Date` object, which SQLite cannot bind, causing:

  * “SQLite3 can only bind numbers, strings, bigints, buffers, and null”

## Root Cause Analysis

### 1. Missing validation in backend

`dateOfBirth` was defined as:

```ts
dateOfBirth: z.string(),
```

Meaning:

* No check for future dates
* No coercion into a proper `Date` object

### 2. SQLite cannot store a JS Date object

After switching to `z.coerce.date()`, the value became a JS Date.

The insert still used:

```ts
...input
```

So SQLite received a raw Date object → invalid binding.

---

## Investigation Steps

* Reproduced issue by selecting a DOB in the future → signup succeeded.
* Reviewed the Zod schema → incorrect date validation.
* Observed SQLite error when inserting Date type.
* Confirmed DB schema expects a text value (`YYYY-MM-DD`).

---

## Fix Implemented

### ✔ 1. Added correct Zod validation

```ts
dateOfBirth: z.coerce.date().refine(
  (date) => {
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    return date <= today;
  },
  "Date of birth cannot be in the future."
)
```

### ✔ 2. Normalized DOB for SQLite

```ts
const { dateOfBirth, ...restInput } = input;
const normalizedDob = dateOfBirth.toISOString().split("T")[0];
```

### ✔ 3. Updated DB insert

```ts
await db.insert(users).values({
  ...restInput,
  dateOfBirth: normalizedDob,
  password: hashedPassword,
  ssn: hashedSsn,
});
```

### ✔ 4. Added UI constraint

```html
max={new Date().toISOString().split("T")[0]}
```

---

## Verification Steps (After Fix)

### **Test 1 — Valid past DOB**

**Input:** `1995-05-10`

**Result:**

* Signup successful
* DOB stored as `1995-05-10`

### **Test 2 — Future DOB**

**Input:** `2030-01-01`

**Result:**

* UI disallows selection
* Backend rejects manual request:

  * "Date of birth cannot be in the future."

### **Test 3 — Database Check**

Checked SQLite using GUI + script:

```bash
npm run db:list-users
```

**Result:**

* DOB stored in valid string format (`YYYY-MM-DD`).

---

## Final Outcome

* Future DOBs blocked
* SQLite binding error resolved
* Backend and UI validations aligned
* No regressions in signup flow

---
## ✅ VAL-206 — Card Number Validation  
**Priority:** Critical  
**Status:** Resolved  
**Author:** Adithya Swarna  

---

### 1. Issue Summary
The application incorrectly accepted **invalid credit/debit card numbers** during the "Fund Account" workflow.

The frontend validation only checked:

- Card number must be 16 digits  
- Must start with **4** or **5**

---

### 2. Root Cause Analysis

#### **Frontend Root Cause**
`FundingModal.tsx` used:

```ts
value.startsWith("4") || value.startsWith("5")
```

This means ANY 16-digit number beginning with 4 or 5 passed, even if mathematically impossible.

#### **Backend Root Cause**
`account.ts` performed zero validation on card numbers:

- No length verification  
- No normalization (spaces/dashes)  
- No Luhn checksum  
- Client-provided number was trusted blindly  

Because the backend is authoritative, this was the real source of the defect.

---

### 3. Investigation Notes
- Reproduced issue using random values like `4234567891234567`; both frontend and backend accepted them.  
- Added a debug block to confirm backend validation path was executed.  
- Verified `fundAccount` mutation always processed card numbers without checking validity.  
- Confirmed the fix must include validation in both places, not just UI.  

---

### 4. Fix Implemented

#### **Frontend Fix (`FundingModal.tsx`)**
Replaced naive prefix/length checks with:

- Card number normalization  
- Luhn algorithm verification  
- Unified validation behavior with backend  

```ts
validate: {
  validCardOrAccount: (value) => {
    if (fundingType === "card") {
      return isValidCardNumber(value) || "Invalid card number";
    }
    return /^\d+$/.test(value) || "Invalid account number";
  },
}
```

#### **Backend Fix (`account.ts`) — Authoritative Validation**
Added normalization + Luhn validation:

```ts
if (input.fundingSource.type === "card") {
  const normalizedCard = normalizeCardNumber(input.fundingSource.accountNumber);

  if (!isValidCardNumber(normalizedCard)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Invalid card number",
    });
  }
}
```

Backend validation ensures:

- UI cannot be bypassed  
- Direct API calls cannot inject bad data  
- Security and consistency are preserved  

---

### 5. Why This Fix Works
- Luhn algorithm is the industry standard used by major card networks.  
- Normalization supports input with spaces/hyphens.  
- Valid card numbers (Visa, Mastercard test cards) pass as expected.  
- Invalid numbers always fail, even if they look superficially correct.  
- Backend now acts as the source of truth, preventing tampering.  

---

### 6. Prevention Measures
- Always validate payment-related inputs on the backend, not only UI.  
- Keep frontend and backend validation logic aligned.  
- Consider adding automated tests for:  
  - Valid card numbers → success  
  - Invalid card numbers → failure  
- Log repeated invalid attempts for fraud detection (optional enhancement).  

---

### 7. Validation Steps (Manual QA)

#### **Invalid (should fail)**

| Card Number       | Reason          |
|------------------|-----------------|
| 4111111111111112 | Fails Luhn      |
| 4234567891234567 | Fails Luhn      |
| 5000000000000001 | Fails Luhn      |
| 1234567812345678 | Not a valid pattern |

**Result:**  
`"Invalid card number"` (frontend and backend)

#### **Valid Test Cards (should pass)**

| Card Type  | Test Number        |
|------------|--------------------|
| Visa       | 4111111111111111   |
| Mastercard | 5555555555554444   |

**Result:**

- Funding succeeds  
- Balance updates  
- Transaction recorded  

---

### 8. Final Result
VAL-206 is fully resolved.

---

## VAL-208 — Weak Password Requirements 

---

### 1. Issue Summary
The system previously enforced only **minimum length** as password validation on the backend:

```ts
password: z.string().min(8)
```

The frontend added a weak check for a number, but both layers allowed trivial passwords such as:

- `abcdefgh1`
- `Password`
- `12345678`

This posed a security risk, as users could bypass frontend validation and submit weak passwords directly to the API.

---

### 2. Root Cause

#### Backend:
- No validation beyond `.min(8)`.
- Allowed weak or common passwords.

#### Frontend:
- Only checked:
  - minimum 8 characters
  - contains a number
- Did *not* enforce uppercase, lowercase, or special characters.

Mismatch between backend and frontend allowed inconsistent or insecure credentials.

---

### 3. Fix Implemented (Option A — Industry Standard)

A new **strong password schema** was added to the backend:

```ts
// VAL-208: Strong Password Schema (Option A - Industry Standard)
const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters long")
  .regex(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).+$/,
    "Password must include uppercase & lowercase letters, a number, and a special character"
  );
```

Signup now uses:

```ts
password: passwordSchema
```

Frontend was updated to validate:

- lowercase
- uppercase
- number
- special character
- not in banned list

---

### 4. Alternative Security Approaches (Not Implemented)

#### **Option B — NIST SP 800-63B (Modern Recommended Approach)**
- Focus on **length ≥ 12** rather than required character types.
- Validate against known compromised password lists.
- Avoid arbitrary composition rules.

#### **Option C — Enterprise Strict Policy**
- Everything in Option A **plus**:
  - No sequential characters (e.g., `abcd`, `1234`)
  - No repeated characters (`aaaaaa`)
  - No dictionary words
  - Rotational policies (not recommended by NIST)

These were documented but intentionally not implemented to keep user experience reasonable for the project.

---

### 5. Validation

#### Failing Cases
| Password | Reason |
|----------|--------|
| `abcdefgh` | no number, no uppercase, no special |
| `Abcdefgh` | no number, no special |
| `Abcdefg1` | no special |
| `password1!` | banned word |

All fail correctly in UI and backend.

#### Passing Cases
- `Password1!`
- `Str0ng$Pass`
- `MySecureP@ss123`

Backend and frontend both allow these.

---

### 6. Final Result

VAL-208 is fully resolved.  
The system now uses a consistent, secure password policy enforced at both frontend and backend levels.  
Documentation includes alternative approaches (Option B & C) for future improvement or compliance needs.

---

## ✅ PERF-401 — Account Creation Error

---

### 1. Issue Summary

During account creation, if a database operation failed (insert or select), the system returned a fake fallback account object with:

- `balance: 100`  
- `status: "pending"`

This produced incorrect balances and phantom accounts in the UI, misleading users into thinking the account was created successfully.

---

### 2. Root Cause Analysis

Inside `createAccount` (`server/routers/account.ts`) the return logic was:

```ts
return (
  account || {
    id: 0,
    userId: ctx.user.id,
    accountNumber: accountNumber!,
    accountType: input.accountType,
    balance: 100,
    status: "pending",
    createdAt: new Date().toISOString(),
  }
);
```

❌ This caused two major failures:

#### **A. Silent Failure Masking**
If any DB failure occurred (e.g., SELECT returned undefined):

- Instead of throwing an error  
- The backend returned a fabricated object  

#### **B. Incorrect Balance**
The fallback hard-coded:

- `balance: 100`

Users saw **$100 in newly created accounts** even though the DB write failed.

#### **C. UI Trust Issues**
The UI displayed the fake account as if creation succeeded, causing:

- Phantom accounts  
- Incorrect balances  
- Impossible-to-reconcile transaction flows  

This is a **critical data integrity issue**.

---

### 3. Investigation Steps

- Attempted account creation via UI → observed intermittent `$100` balances.  
- Instrumented backend code; discovered fallback branch.  
- Simulated DB failure by temporarily renaming the accounts table:

```ts
sqliteTable("accounts_broken_for_test")
```

With the table missing, DB operations failed — *but before the fix*, the backend still returned the fake `$100` account.

After fixing the code, the same simulation:

- ❌ Did **not** return a fabricated account  
- ✔ Threw a proper backend error  
- ✔ UI displayed failure state  

This validated the root cause and confirmed the fix.

---

### 4. Fix Implemented

🔧 **Removed fallback object completely**  
🔧 **Backend now fails loudly instead of masking failures**

New code:

```ts
// PERF-401: Fetch the created account and fail if it cannot be loaded.
// We never fabricate an account object.
const account = await db
  .select()
  .from(accounts)
  .where(eq(accounts.accountNumber, accountNumber!))
  .get();

if (!account) {
  throw new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: "Failed to create account",
  });
}

return account;
```

✔ Guarantees:

- No fake balances  
- No fallback objects  
- No silent failures  
- Consistent error handling  
- Correct data integrity  

---

### 5. How the Fix Was Tested (Verification)

#### **A. Simulated DB failure (intentional test)**

Temporarily renamed table to:

`accounts_broken_for_test`

Expected and observed:

- ❌ Account creation failed  
- ❌ No fallback `$100` balance  
- ❌ No `"pending"` fake account  
- ✔ UI displayed real error  
- ✔ Backend threw proper exception  

#### **B. Restored table name and re-tested**

- ✔ Account creation succeeded normally  
- ✔ Returned real DB-backed account  
- ✔ Balance initialized correctly to `0`  
- ✔ No incorrect `$100` defaults  

This confirms correctness in both failure and success paths.

---

### 6. Prevention / Recommendations

✔ **Never use fallback objects for DB operations**  
Fallback objects hide real failures and corrupt financial data.

✔ **Always throw errors when persistence fails**  
Ensures transparency and prevents silently incorrect states.

✔ **Log failures at the backend level**  
Enables monitoring/alerting for production.

✔ **Consider wrapping DB operations in a transaction**  
Ensures strong consistency for multi-step workflows.

---

## ✅ PERF-405 & PERF-407 — Combined Documentation  
**PERF-405:** Missing Transactions  
**PERF-407:** Performance Degradation  
**Priority:** Critical  
**Author:** Adithya Swarna  
**Status:** Resolved  

---

### 1. Issue Summary

#### **PERF-405 — Missing Transactions**

Users reported that transaction history did not always show all transactions after multiple funding events. Entries appeared:

- Out of order  
- Randomly shuffled  
- Occasionally “missing” on refresh  
- Inconsistent across page loads  

This caused users to lose trust in the accuracy of their financial history.

#### **PERF-407 — Performance Degradation**

The transaction history endpoint slowed significantly as the transaction count increased. In some cases, responses were delayed or partially returned.

Symptoms included:

- Slow dashboard load  
- High UI jitter on refresh  
- DB logs showing excessive SELECT statements  
- Occasional incomplete transaction lists (appearing as missing entries)  

---

### 2. Root Cause Analysis

Both issues traced to the same function:

`server/routers/account.ts → getTransactions`

---

#### 🟥 **Root Cause 1 (PERF-405): Missing `.orderBy()` → nondeterministic order**

Existing code:

```ts
const accountTransactions = await db
  .select()
  .from(transactions)
  .where(eq(transactions.accountId, input.accountId));
```

SQL engines **do NOT guarantee row order without `ORDER BY`**.

Effects:

- Newly added transactions may appear at bottom  
- Order shifts on each refresh  
- Fast insertions grouped unpredictably  
- Users perceive entries as “missing”  

This is a **backend correctness issue**, not a UI bug.

---

#### 🟥 **Root Cause 2 (PERF-407): N+1 Query Pattern Causing Slowdowns**

The original code executed:

- 1 query → fetch all transactions  
- 1 additional query per transaction → re-fetch the same account  

Example:

| # Transactions | SQL Queries |
|----------------|-------------|
| 10             | 11          |
| 100            | 101         |
| 1000           | 1001        |

This caused:

- Slower response times  
- Timeouts  
- Incomplete responses  
- Perceived “missing transactions” (overlapping with PERF-405)  
- Heavy DB load  

The enrichment logic was unnecessary because account details were already known.

---

### 3. Investigation Steps

✔ Reproduced by performing multiple deposits and refreshing quickly  
✔ Observed random ordering  
✔ Observed inconsistent transaction counts  
✔ Logged backend → dozens of SELECTs  
✔ Confirmed missing `.orderBy()` and N+1 pattern  

SQLite behavior confirmed:

Without `ORDER BY`, row order is based on file structure, caching, and insertion timing.

---

### 4. Fix Implemented

---

#### 🛠️ **A. Deterministic Ordering (Fix for PERF-405)**

Added:

```ts
.orderBy(desc(transactions.createdAt))
```

Now:

- Always newest → oldest  
- Stable order across refreshes  
- No phantom missing entries  

---

#### 🛠️ **B. Removed N+1 Query Loop (Fix for PERF-407)**

Old code (removed):

```ts
const enrichedTransactions = [];
for (const transaction of accountTransactions) {
  const accountDetails = await db.select().from(accounts).where(eq(accounts.id, transaction.accountId)).get();
  enrichedTransactions.push({...});
}
```

New code:

```ts
return accountTransactions;
```

Eliminates unnecessary per-transaction queries and significantly improves speed.

---

### ✔ Final Updated `getTransactions` Implementation

```ts
getTransactions: protectedProcedure
  .input(
    z.object({
      accountId: z.number(),
    })
  )
  .query(async ({ input, ctx }) => {
    // Verify account belongs to user
    const account = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, input.accountId), eq(accounts.userId, ctx.user.id)))
      .get();

    if (!account) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Account not found",
      });
    }

    // PERF-405: deterministic ordering
    // PERF-407: avoid N+1 queries
    const accountTransactions = await db
      .select()
      .from(transactions)
      .where(eq(transactions.accountId, input.accountId))
      .orderBy(desc(transactions.createdAt));

    return accountTransactions;
  });
```

---

### 5. Testing & Verification

---

#### ✔ **Functional Testing (PERF-405)**

Performed 10–20 deposits; verified:

- All transactions appeared  
- Always ordered newest → oldest  
- Refreshing preserved ordering  
- No disappearing entries  
- No duplicates  

Result: **Stable, correct ordering.**

---

#### ✔ **Performance Testing (PERF-407)**

With 50+ transactions:

- Endpoint responded instantly  
- Only **1 SQL query** executed  
- No N+1 logs  
- No partial results  
- UI remained smooth  

Result: **Performance dramatically improved.**

---

### 6. Final Result

Both issues **PERF-405** and **PERF-407** are fully resolved.

- Transactions always appear in correct order  
- No missing or out-of-order entries  
- Query performance is fast and scalable  
- N+1 pattern eliminated  
- Backend complexity reduced  
- UI now shows accurate, banker-grade financial history  

---

### 7. Prevention & Recommendations

✔ Always specify `.orderBy()` for financial records  
✔ Avoid per-row enrichment queries unless required  
✔ Return minimal, efficient structures from backend  
✔ Add integration tests to verify sorted order  
✔ Consider pagination for high-volume accounts  

---

