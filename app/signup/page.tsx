"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { trpc } from "@/lib/trpc/client";
import Link from "next/link";


// VAL-203 (Author: Adithya Swarna)
// Frontend mirror of backend US state validation.
const US_STATE_CODES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA",
  "HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
  "DC",
];

const PHONE_REGEX = /^\+[1-9]\d{9,14}$/;

type SignupFormData = {
  email: string;
  password: string;
  confirmPassword: string;
  firstName: string;
  lastName: string;
  phoneNumber: string;
  dateOfBirth: string;
  ssn: string;
  address: string;
  city: string;
  state: string;
  zipCode: string;
};

export default function SignupPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [error, setError] = useState("");
  // VAL-202 (Author: Adithya Swarna)
  // Frontend guardrail: prevent selecting a future date of birth.
  const todayStr = new Date().toISOString().split("T")[0];

  // VAL-201 (Author: Adithya Swarna)
  // Allowed top-level domains for client-side email validation.
  // This keeps the validation readable and avoids hard-coding typo endings like ".con" or ".moc".
  const allowedTlds = [
    "com", "org", "net", "edu", "gov", "io", "ai", "co", "us", "in",
    "info", "biz", "online", "tech"
  ];

  const {
    register,
    handleSubmit,
    formState: { errors },
    watch,
    trigger,
  } = useForm<SignupFormData>();
  const signupMutation = trpc.auth.signup.useMutation();

  const password = watch("password");

  const nextStep = async () => {
    let fieldsToValidate: (keyof SignupFormData)[] = [];

    if (step === 1) {
      fieldsToValidate = ["email", "password", "confirmPassword"];
    } else if (step === 2) {
      fieldsToValidate = ["firstName", "lastName", "phoneNumber", "dateOfBirth"];
    }

    const isValid = await trigger(fieldsToValidate);
    if (isValid) {
      setStep(step + 1);
    }
  };

  const prevStep = () => setStep(step - 1);

  const onSubmit = async (data: SignupFormData) => {
    try {
      setError("");
      await signupMutation.mutateAsync(data);
      router.push("/dashboard");
    } catch (err: any) {
      setError(err.message || "Something went wrong");
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">Create your account</h2>
          <p className="mt-2 text-center text-sm text-gray-600">Step {step} of 3</p>
        </div>

        <form className="mt-8 space-y-6" onSubmit={handleSubmit(onSubmit)}>
          {step === 1 && (
            <div className="space-y-4">
              
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-gray-700">
                  Email
                </label>
                <input
                  // VAL-201 (Author: Adithya Swarna)
                  // Frontend email validation:
                  //  - Requires basic name@domain.tld format
                  //  - Validates TLD against a small allow-list (com, org, net, io, in, etc.)
                  //  - Matches backend behavior where email is normalized to lowercase
                  {...register("email", {
                    required: "Email is required",
                    pattern: {
                      // Ensures "name@domain.tld" with at least one dot in the domain.
                      value: /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/i,
                      message: "Enter a valid email address (e.g., name@example.com)",
                    },
                    validate: {
                      validTld: (value) => {
                        const lower = value.toLowerCase().trim();
                        const parts = lower.split(".");
                        const tld = parts[parts.length - 1];

                        if (!tld || !allowedTlds.includes(tld)) {
                          return `The domain ".${tld}" is not recognized. Did you mean ".com"?`;
                        }

                        return true;
                      },
                    },
                  })}
                  type="email"
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2 border"
                />
                {errors.email && (
                  <p className="mt-1 text-sm text-red-600">{errors.email.message}</p>
                )}

                {/* Optional UX note to explain lowercase normalization on backend */}
                <p className="mt-1 text-xs text-gray-500">
                  We&apos;ll store your email in lowercase (e.g., name@example.com) for consistency.
                </p>
              </div>
              
              <div>
                <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                  Password
                </label>

                <input
                  {...register("password", {
                    required: "Password is required",

                    // Minimum length requirement (still part of Option A)
                    minLength: {
                      value: 8,
                      message: "Password must be at least 8 characters",
                    },

                    // VAL-208: Strong password validation (Option A - Industry Standard)
                    // Requirements:
                    //  - At least one lowercase character
                    //  - At least one uppercase character
                    //  - At least one number
                    //  - At least one special character
                    //  - Not a very common password (e.g., password, 12345678)
                    //
                    // Notes:
                    //  Option B (NIST): Would focus on length ≥ 12 and breached-password lists.
                    //  Option C (Enterprise Strict): Would add no sequences, no repeats, etc.
                    validate: {
                      notCommon: (value) => {
                        const commonPasswords = ["password", "12345678", "qwerty"];
                        return (
                          !commonPasswords.includes(value.toLowerCase()) ||
                          "Password is too common"
                        );
                      },

                      hasLowercase: (value) =>
                        /[a-z]/.test(value) ||
                        "Password must contain at least one lowercase letter",

                      hasUppercase: (value) =>
                        /[A-Z]/.test(value) ||
                        "Password must contain at least one uppercase letter",

                      hasNumber: (value) =>
                        /\d/.test(value) ||
                        "Password must contain at least one number",

                      hasSpecial: (value) =>
                        /[^A-Za-z0-9]/.test(value) ||
                        "Password must contain at least one special character",
                    },
                  })}
                  type="password"
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2 border"
                />
                
                

                {errors.password && (
                  <p className="mt-1 text-sm text-red-600">{errors.password.message}</p>
                )}

                {/* Optional hint for better UX */}
                <p className="mt-1 text-xs text-gray-500">
                  Use at least 8 characters with upper & lowercase letters, a number, and a special character.
                </p>
              </div>

              <div>
                <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700">
                  Confirm Password
                </label>
                <input
                  {...register("confirmPassword", {
                    required: "Please confirm your password",
                    validate: (value) => value === password || "Passwords do not match",
                  })}
                  type="password"
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2 border"
                />
                {errors.confirmPassword && (
                  <p className="mt-1 text-sm text-red-600">{errors.confirmPassword.message}</p>
                )}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="firstName" className="block text-sm font-medium text-gray-700">
                    First Name
                  </label>
                  <input
                    {...register("firstName", { required: "First name is required" })}
                    type="text"
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2 border"
                  />
                  {errors.firstName && <p className="mt-1 text-sm text-red-600">{errors.firstName.message}</p>}
                </div>

                <div>
                  <label htmlFor="lastName" className="block text-sm font-medium text-gray-700">
                    Last Name
                  </label>
                  <input
                    {...register("lastName", { required: "Last name is required" })}
                    type="text"
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2 border"
                  />
                  {errors.lastName && <p className="mt-1 text-sm text-red-600">{errors.lastName.message}</p>}
                </div>
              </div>

              <div>
                <label htmlFor="phoneNumber" className="block text-sm font-medium text-gray-700">
                  Phone Number
                </label>
                <input
                  {...register("phoneNumber", {
                    required: "Phone number is required",
                    validate: (value) =>
                      PHONE_REGEX.test(value.trim()) ||
                      'Use international format, e.g. "+14155552671".',
                  })}
                  type="tel"
                  placeholder="+14155552671"
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2 border"
                />
                {errors.phoneNumber && <p className="mt-1 text-sm text-red-600">{errors.phoneNumber.message}</p>}
              </div>

              <div>
                <label htmlFor="dateOfBirth" className="block text-sm font-medium text-gray-700">
                  Date of Birth
                </label>
                <input
                  {...register("dateOfBirth", { required: "Date of birth is required" })}
                  type="date"
                  max={todayStr} // VAL-202: disallow future dates in UI
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2 border"
                />
                {errors.dateOfBirth && <p className="mt-1 text-sm text-red-600">{errors.dateOfBirth.message}</p>}
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <div>
                <label htmlFor="ssn" className="block text-sm font-medium text-gray-700">
                  Social Security Number
                </label>
                <input
                  {...register("ssn", {
                    required: "SSN is required",
                    pattern: {
                      value: /^\d{9}$/,
                      message: "SSN must be 9 digits",
                    },
                  })}
                  type="text"
                  placeholder="123456789"
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2 border"
                />
                {errors.ssn && <p className="mt-1 text-sm text-red-600">{errors.ssn.message}</p>}
              </div>

              <div>
                <label htmlFor="address" className="block text-sm font-medium text-gray-700">
                  Street Address
                </label>
                <input
                  {...register("address", { required: "Address is required" })}
                  type="text"
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2 border"
                />
                {errors.address && <p className="mt-1 text-sm text-red-600">{errors.address.message}</p>}
              </div>

              <div className="grid grid-cols-6 gap-4">
                <div className="col-span-3">
                  <label htmlFor="city" className="block text-sm font-medium text-gray-700">
                    City
                  </label>
                  <input
                    {...register("city", { required: "City is required" })}
                    type="text"
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2 border"
                  />
                  {errors.city && <p className="mt-1 text-sm text-red-600">{errors.city.message}</p>}
                </div>

                <div className="col-span-1">
                  <label htmlFor="state" className="block text-sm font-medium text-gray-700">
                    State
                  </label>
                  <input
                    {...register("state", {
                      required: "State is required",
                      validate: (value) => {
                        const normalized = value.trim().toUpperCase();
                        return (
                          US_STATE_CODES.includes(normalized) ||
                          "Enter a valid US state (e.g., CA, NY)"
                        );
                      },
                    })}
                    type="text"
                    placeholder="CA"
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2 border uppercase"
                  />
                  {errors.state && <p className="mt-1 text-sm text-red-600">{errors.state.message}</p>}
                </div>

                <div className="col-span-2">
                  <label htmlFor="zipCode" className="block text-sm font-medium text-gray-700">
                    ZIP Code
                  </label>
                  <input
                    {...register("zipCode", {
                      required: "ZIP code is required",
                      pattern: {
                        value: /^\d{5}$/,
                        message: "ZIP code must be 5 digits",
                      },
                    })}
                    type="text"
                    placeholder="12345"
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2 border"
                  />
                  {errors.zipCode && <p className="mt-1 text-sm text-red-600">{errors.zipCode.message}</p>}
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-md bg-red-50 p-4">
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}

          <div className="flex justify-between">
            {step > 1 && (
              <button
                type="button"
                onClick={prevStep}
                className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                Previous
              </button>
            )}

            {step < 3 ? (
              <button
                type="button"
                onClick={nextStep}
                className="ml-auto px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                Next
              </button>
            ) : (
              <button
                type="submit"
                disabled={signupMutation.isPending}
                className="ml-auto px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
              >
                {signupMutation.isPending ? "Creating account..." : "Create Account"}
              </button>
            )}
          </div>
        </form>

        <p className="text-center text-sm text-gray-600">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-blue-600 hover:text-blue-500">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
