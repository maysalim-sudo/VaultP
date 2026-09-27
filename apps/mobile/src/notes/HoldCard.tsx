/**
 * A note card that answers to how long it is held.
 *
 *   tap                      open the note
 *   hold, let go by 0.5 s    the note's options drawer
 *   keep holding             a line traces the card's border; at 1.2 s the loop
 *                            closes, the phone ticks, and the card lifts off to
 *                            be dragged — onto another note to reorder, or onto
 *                            a folder, label, Archive or Done chip to file it
 *
 * The trace is the whole point of the long hold: it shows the hold is going
 * somewhere, and lets go gracefully — lift the finger mid-trace and nothing
 * happens, the line simply withdraws. Moving the finger before the lift is a
 * scroll, not a hold, and hands the touch back to the list.
 *
 * Built on PanResponder and Animated from React Native itself, with the trace
 * on the native driver so it stays smooth while the list is busy.
 */

import { useEffect, useRef, type ReactNode } from 'react';
import {
  Animated,
  Easing,
  PanResponder,
  StyleSheet,
  Vibration,
  View,
  type GestureResponderEvent,
  type PanResponderGestureState,
} from 'react-native';

/** Released after this but before TRACE_FROM: the options drawer. */
export const MENU_AFTER_MS = 280;
/** Held this long: the border trace begins. */
export const TRACE_FROM_MS = 500;
/** Held this long: the trace completes and the card can be dragged. */
export const LIFT_AT_MS = 1200;
/** Further than this before the lift is a scroll, not a hold. */
const SLOP = 10;

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Frame {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface HoldCardProps {
  children: ReactNode;
  /** The colour of the trace. */
  accent: string;
  radius: number;
  /** While this card is the one being dragged: shown as a faint placeholder. */
  ghost?: boolean;
  /** A drop here would land just above or below this card. */
  dropEdge?: 'before' | 'after' | null;
  onTap: () => void;
  onMenu: () => void;
  onLift: (touch: Point, frame: Frame) => void;
  onDragMove: (touch: Point) => void;
  onDrop: (touch: Point) => void;
  onDragCancel: () => void;
  /** For measuring the card when a drag starts elsewhere. */
  viewRef?: (view: View | null) => void;
}

type Phase = 'idle' | 'pressing' | 'menu' | 'tracing' | 'dragging' | 'cancelled';

export function HoldCard(props: HoldCardProps) {
  const latest = useRef(props);
  latest.current = props;

  const view = useRef<View | null>(null);
  const phase = useRef<Phase>('idle');
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const lastTouch = useRef<Point>({ x: 0, y: 0 });

  const scale = useRef(new Animated.Value(1)).current;
  const progress = useRef(new Animated.Value(0)).current;

  function clearTimers() {
    for (const timer of timers.current) clearTimeout(timer);
    timers.current = [];
  }

  function settle() {
    clearTimers();
    progress.stopAnimation();
    Animated.parallel([
      Animated.timing(progress, { toValue: 0, duration: 160, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(scale, { toValue: 1, duration: 160, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();
  }

  function lift() {
    if (phase.current !== 'tracing') return;
    phase.current = 'dragging';
    Vibration.vibrate(24);
    const touch = lastTouch.current;
    view.current?.measureInWindow((x, y, width, height) => {
      if (phase.current === 'dragging') latest.current.onLift(touch, { x, y, width, height });
    });
    // The card left behind returns to size; the parent draws the lifted copy.
    Animated.timing(scale, { toValue: 1, duration: 120, useNativeDriver: true }).start();
  }

  function begin(event: GestureResponderEvent) {
    phase.current = 'pressing';
    lastTouch.current = { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY };
    Animated.timing(scale, {
      toValue: 0.97,
      duration: 120,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();

    timers.current.push(
      setTimeout(() => {
        if (phase.current === 'pressing') {
          phase.current = 'menu';
          Vibration.vibrate(8);
        }
      }, MENU_AFTER_MS),
      setTimeout(() => {
        if (phase.current !== 'menu') return;
        phase.current = 'tracing';
        Animated.timing(progress, {
          toValue: 1,
          duration: LIFT_AT_MS - TRACE_FROM_MS,
          // Constant speed around the border, like a progress ring.
          easing: Easing.linear,
          useNativeDriver: true,
        }).start(({ finished }) => {
          if (finished) lift();
        });
      }, TRACE_FROM_MS),
    );
  }

  function move(_event: GestureResponderEvent, gesture: PanResponderGestureState) {
    lastTouch.current = { x: gesture.moveX, y: gesture.moveY };
    if (phase.current === 'dragging') {
      latest.current.onDragMove(lastTouch.current);
      return;
    }
    if (phase.current !== 'cancelled' && Math.hypot(gesture.dx, gesture.dy) > SLOP) {
      phase.current = 'cancelled';
      settle();
    }
  }

  function end() {
    const was = phase.current;
    phase.current = 'idle';
    settle();
    if (was === 'pressing') latest.current.onTap();
    else if (was === 'menu') latest.current.onMenu();
    else if (was === 'dragging') latest.current.onDrop(lastTouch.current);
  }

  function terminate() {
    const was = phase.current;
    phase.current = 'idle';
    settle();
    if (was === 'dragging') latest.current.onDragCancel();
  }

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: begin,
      onPanResponderMove: move,
      onPanResponderRelease: end,
      onPanResponderTerminate: terminate,
      // The list may take the touch back to scroll — until the card is lifted.
      onPanResponderTerminationRequest: () => phase.current !== 'dragging',
      // Blocking would stop the list scrolling whenever a scroll began on a card.
      onShouldBlockNativeResponder: () => false,
    }),
  ).current;

  useEffect(() => clearTimers, []);

  // The four sides, drawn in turn: top left→right, right down, bottom
  // right→left, left up — one continuous line round the card.
  const side = (from: number, to: number) =>
    progress.interpolate({ inputRange: [from, to], outputRange: [0, 1], extrapolate: 'clamp' });

  return (
    <Animated.View
      ref={(node: View | null) => {
        view.current = node;
        props.viewRef?.(node);
      }}
      collapsable={false}
      {...responder.panHandlers}
      style={[
        { transform: [{ scale }], borderRadius: props.radius },
        props.ghost ? styles.ghost : null,
      ]}
    >
      {props.children}

      <View pointerEvents="none" style={[styles.traceFrame, { borderRadius: props.radius }]}>
        <Animated.View
          style={[styles.top, { backgroundColor: props.accent, transform: [{ scaleX: side(0, 0.25) }] }]}
        />
        <Animated.View
          style={[styles.right, { backgroundColor: props.accent, transform: [{ scaleY: side(0.25, 0.5) }] }]}
        />
        <Animated.View
          style={[styles.bottom, { backgroundColor: props.accent, transform: [{ scaleX: side(0.5, 0.75) }] }]}
        />
        <Animated.View
          style={[styles.left, { backgroundColor: props.accent, transform: [{ scaleY: side(0.75, 1) }] }]}
        />
      </View>

      {props.dropEdge ? (
        <View
          pointerEvents="none"
          style={[
            styles.dropMark,
            { backgroundColor: props.accent },
            props.dropEdge === 'before' ? styles.dropBefore : styles.dropAfter,
          ]}
        />
      ) : null}
    </Animated.View>
  );
}

const LINE = 3;

const styles = StyleSheet.create({
  ghost: { opacity: 0.25 },
  traceFrame: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    overflow: 'hidden',
  },
  top: { position: 'absolute', top: 0, left: 0, right: 0, height: LINE, transformOrigin: 'left' },
  right: { position: 'absolute', top: 0, bottom: 0, right: 0, width: LINE, transformOrigin: 'top' },
  bottom: { position: 'absolute', bottom: 0, left: 0, right: 0, height: LINE, transformOrigin: 'right' },
  left: { position: 'absolute', top: 0, bottom: 0, left: 0, width: LINE, transformOrigin: 'bottom' },
  dropMark: { position: 'absolute', left: 6, right: 6, height: 4, borderRadius: 2 },
  dropBefore: { top: -6 },
  dropAfter: { bottom: -6 },
});
