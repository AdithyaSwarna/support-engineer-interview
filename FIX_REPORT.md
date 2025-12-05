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

