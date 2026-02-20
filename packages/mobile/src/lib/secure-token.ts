/**
 * Secure token storage — wraps expo-secure-store for API token persistence.
 *
 * Tokens must NEVER be stored in AsyncStorage (plaintext, trivially readable).
 * SecureStore uses the iOS Keychain / Android Keystore.
 */

import * as SecureStore from "expo-secure-store";

const API_TOKEN_KEY = "mast-api-token";

export async function getSecureApiToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(API_TOKEN_KEY);
  } catch {
    return null;
  }
}

export async function setSecureApiToken(token: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(API_TOKEN_KEY, token);
  } catch (err) {
    console.error("[secure-token] Failed to store token:", err);
  }
}

export async function deleteSecureApiToken(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(API_TOKEN_KEY);
  } catch {
    // Ignore — key may not exist
  }
}
