/**
 * AnimatedPressable — Pressable with subtle Reanimated scale animation.
 *
 * Drop-in replacement for TouchableOpacity. Runs animations on the UI thread
 * via Reanimated worklets — zero JS thread impact.
 */

import React from "react";
import { Pressable, type PressableProps, type ViewStyle, type StyleProp } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
} from "react-native-reanimated";

const AnimatedPressableBase = Animated.createAnimatedComponent(Pressable);

const PRESS_SCALE = 0.97;
const PRESS_DURATION = 100;
const RELEASE_DURATION = 150;

interface AnimatedPressableProps extends Omit<PressableProps, "style"> {
  style?: StyleProp<ViewStyle>;
  /** Scale factor when pressed. Default: 0.97 */
  pressScale?: number;
  /** Whether to disable the press animation. Default: false */
  noAnimation?: boolean;
}

function AnimatedPressableInner(
  {
    style,
    pressScale = PRESS_SCALE,
    noAnimation = false,
    onPressIn,
    onPressOut,
    disabled,
    ...rest
  }: AnimatedPressableProps,
  ref: React.Ref<React.ComponentRef<typeof Pressable>>,
) {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn: PressableProps["onPressIn"] = (e) => {
    if (!noAnimation) {
      scale.value = withTiming(pressScale, { duration: PRESS_DURATION });
    }
    onPressIn?.(e);
  };

  const handlePressOut: PressableProps["onPressOut"] = (e) => {
    if (!noAnimation) {
      scale.value = withTiming(1, { duration: RELEASE_DURATION });
    }
    onPressOut?.(e);
  };

  return (
    <AnimatedPressableBase
      ref={ref}
      style={[animatedStyle, style]}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={disabled}
      {...rest}
    />
  );
}

const AnimatedPressable = React.forwardRef(AnimatedPressableInner);
AnimatedPressable.displayName = "AnimatedPressable";

export default AnimatedPressable;
