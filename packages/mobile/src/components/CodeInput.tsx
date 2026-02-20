/**
 * CodeInput — 6-digit verification code input for pairing.
 * Auto-advances focus between cells. Supports paste.
 */

import React, { useRef, useState, useEffect } from "react";
import { View, TextInput, Text, Keyboard } from "react-native";

interface CodeInputProps {
  length?: number;
  onComplete: (code: string) => void;
  error?: boolean;
}

export default function CodeInput({
  length = 6,
  onComplete,
  error = false,
}: CodeInputProps) {
  const [digits, setDigits] = useState<string[]>(Array(length).fill(""));
  const inputRefs = useRef<(TextInput | null)[]>([]);

  // Reset on error
  useEffect(() => {
    if (error) {
      setDigits(Array(length).fill(""));
      inputRefs.current[0]?.focus();
    }
  }, [error, length]);

  const handleChange = (text: string, index: number) => {
    // Handle paste of full code
    if (text.length > 1) {
      const pasted = text.replace(/\D/g, "").slice(0, length);
      const newDigits = Array(length).fill("");
      for (let i = 0; i < pasted.length; i++) {
        newDigits[i] = pasted[i];
      }
      setDigits(newDigits);
      if (pasted.length === length) {
        Keyboard.dismiss();
        onComplete(pasted);
      } else {
        inputRefs.current[pasted.length]?.focus();
      }
      return;
    }

    const digit = text.replace(/\D/g, "");
    const newDigits = [...digits];
    newDigits[index] = digit;
    setDigits(newDigits);

    if (digit && index < length - 1) {
      inputRefs.current[index + 1]?.focus();
    }

    // Check if all filled
    const code = newDigits.join("");
    if (code.length === length && !code.includes("")) {
      Keyboard.dismiss();
      onComplete(code);
    }
  };

  const handleKeyPress = (key: string, index: number) => {
    if (key === "Backspace" && !digits[index] && index > 0) {
      const newDigits = [...digits];
      newDigits[index - 1] = "";
      setDigits(newDigits);
      inputRefs.current[index - 1]?.focus();
    }
  };

  const borderColor = error
    ? "border-red-500"
    : "border-gray-300 dark:border-gray-600 focus:border-mast-500";

  return (
    <View className="flex-row justify-center gap-2">
      {digits.map((digit, idx) => (
        <TextInput
          key={idx}
          ref={(r) => {
            inputRefs.current[idx] = r;
          }}
          value={digit}
          onChangeText={(text) => handleChange(text, idx)}
          onKeyPress={({ nativeEvent }) => handleKeyPress(nativeEvent.key, idx)}
          keyboardType="number-pad"
          maxLength={idx === 0 ? length : 1}
          className={`w-12 h-14 text-center text-2xl font-bold rounded-xl border-2 ${borderColor} bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100`}
          selectTextOnFocus
          autoFocus={idx === 0}
        />
      ))}
    </View>
  );
}
