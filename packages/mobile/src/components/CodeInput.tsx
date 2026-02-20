/**
 * CodeInput — 6-digit verification code input for pairing.
 * Terminal-style: green focus borders, dark bg, monospace.
 */

import React, { useRef, useState, useEffect } from "react";
import { View, TextInput, Keyboard } from "react-native";
import { useTheme } from "../lib/ThemeContext";
import { fonts } from "../lib/themes";

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
  const { colors } = useTheme();
  const [digits, setDigits] = useState<string[]>(Array(length).fill(""));
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const inputRefs = useRef<(TextInput | null)[]>([]);

  useEffect(() => {
    if (error) {
      setDigits(Array(length).fill(""));
      inputRefs.current[0]?.focus();
    }
  }, [error, length]);

  const handleChange = (text: string, index: number) => {
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

    const code = newDigits.join("");
    if (code.length === length) {
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

  const getBorderColor = (idx: number) => {
    if (error) return colors.danger;
    if (focusedIndex === idx) return colors.success;
    return colors.border;
  };

  return (
    <View style={{ flexDirection: "row", justifyContent: "center", gap: 8 }}>
      {digits.map((digit, idx) => (
        <TextInput
          key={idx}
          ref={(r) => {
            inputRefs.current[idx] = r;
          }}
          value={digit}
          onChangeText={(text) => handleChange(text, idx)}
          onKeyPress={({ nativeEvent }) => handleKeyPress(nativeEvent.key, idx)}
          onFocus={() => setFocusedIndex(idx)}
          onBlur={() => setFocusedIndex(null)}
          keyboardType="number-pad"
          maxLength={idx === 0 ? length : 1}
          selectTextOnFocus
          autoFocus={idx === 0}
          style={{
            width: 44,
            height: 52,
            textAlign: "center",
            fontSize: 22,
            fontFamily: fonts.bold,
            color: colors.bright,
            backgroundColor: colors.surface,
            borderWidth: 1,
            borderColor: getBorderColor(idx),
          }}
        />
      ))}
    </View>
  );
}
