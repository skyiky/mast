/**
 * Tests for the Supabase client module.
 * Verifies the singleton is correctly configured.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { supabase } from "../src/lib/supabase.js";

describe("supabase client", () => {
  it("exports a supabase client instance", () => {
    assert.ok(supabase, "supabase should be defined");
  });

  it("has auth methods", () => {
    assert.equal(typeof supabase.auth.getSession, "function");
    assert.equal(typeof supabase.auth.signInWithOAuth, "function");
    assert.equal(typeof supabase.auth.signOut, "function");
    assert.equal(typeof supabase.auth.onAuthStateChange, "function");
  });
});
