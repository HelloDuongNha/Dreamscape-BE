# **BACKEND_README.md: PRODUCTION ARCHITECTURE ROADMAP**

## **1. SYSTEM ARCHITECTURE**
- **Language:** Node.js (TypeScript) + Express.js.
- **Database:** MongoDB Atlas (Cloud) connected via Mongoose.
- **API Documentation:** Swagger UI at `/api-docs`.
- **Performance Strategy:** - Offset Pagination (`limit`, `skip`) for Dream Feed to prevent DB overhead.
  - Database Indexing on `username`, `userId`, and `created_at`.
- **State Persistence:** JWT (JSON Web Tokens) stored in HttpOnly Cookies or LocalStorage.

## **2. STEP-BY-STEP IMPLEMENTATION PLAN**
- **STEP 1:** Setup Express + TypeScript + MongoDB Connection + Swagger Integration.
- **STEP 2:** Implement User Schema & Auth API (Register, Login, Logout with JWT).
- **STEP 3:** Implement Dream Schema & Pagination API (Create Post, Get Feed with Pagination).
- **STEP 4:** Integrate FE with Real API (Replace Pinia Mock Data with Axios Calls).

## **3. MANDATORY COMPLIANCE FOR AI**
- Every code piece must be clean, modular, and strictly typed (TypeScript).
- Avoid duplication. Re-use existing utility functions.
- After completing ANY step, the AI MUST update `SYSTEM_LOG.md` detailing changes, endpoints created, and pending fixes.