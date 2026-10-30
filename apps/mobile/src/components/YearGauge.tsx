/**
 * The foreign-currency ceiling, as one bar across the allowance year.
 *
 * What is left is the hero, because it is the number you act on. The bar under
 * it holds the rest at a glance: what is spent (steel), what subscriptions will
 * take before the year ends (ochre, fainter — it has not happened yet), and a
 * marker for today, so "half gone" can be read against "half the year gone".
 * The run-out date, if there is one, is a plain sentence rather than a colour.
 */

import { StyleSheet, Text, View } from 'react-native';

import {
  type AllowanceForecast,
  daysBetween,
  formatAmount,
  type IsoDate,
  money,
  radii,
  spacing,
  typeScale,
} from '@vaultp/core';

import { describeDate } from './DateField.js';
import type { Palette } from './theme.js';

function monthShort(date: IsoDate): string {
  const [y, m] = date.split('-').map(Number) as [number, number];
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'short' });
}

export function YearGauge({
  allowance,
  today,
  palette,
}: {
  allowance: AllowanceForecast;
  today: IsoDate;
  palette: Palette;
}) {
  const ceiling = allowance.ceiling.amountMinor;
  const used = allowance.used.amountMinor;
  const committed = allowance.committedTotal.amountMinor;
  const remaining = allowance.remaining.amountMinor;
  const currency = allowance.ceiling.currency;

  const clamp = (n: number) => Math.max(0, Math.min(1, n));
  const usedRatio = ceiling > 0 ? clamp(used / ceiling) : 0;
  // Whatever is to come, drawn only in the room the spent part leaves.
  const comingRatio = ceiling > 0 ? Math.min(1 - usedRatio, clamp(committed / ceiling)) : 0;

  const { start, end, label } = allowance.period;
  const periodDays = daysBetween(start, end) + 1;
  const todayRatio = clamp((daysBetween(start, today) + 1) / periodDays);
  const daysLeft = Math.max(0, daysBetween(today, end));

  // Subscriptions that fall after the run-out date are the ones that will fail.
  const failing = allowance.exhaustionDate
    ? allowance.committed.filter((charge) => charge.date >= allowance.exhaustionDate!).map((charge) => charge.name)
    : [];
  const failingNames = [...new Set(failing)].slice(0, 3);

  return (
    <View>
      <Text style={[styles.eyebrow, { color: palette.dim }]}>Foreign-currency ceiling · {label}</Text>
      {remaining >= 0 ? (
        <Text style={[styles.hero, { color: palette.text }]}>
          {formatAmount(allowance.remaining)}
          <Text style={[styles.heroUnit, { color: palette.dim }]}> left</Text>
        </Text>
      ) : (
        <Text style={[styles.hero, { color: palette.negative }]}>
          {formatAmount(money(-remaining, currency))}
          <Text style={[styles.heroUnit, { color: palette.dim }]}> over</Text>
        </Text>
      )}
      <Text style={[styles.caption, { color: palette.dim }]}>
        of {formatAmount(allowance.ceiling)} · {daysLeft} day{daysLeft === 1 ? '' : 's'} to go
      </Text>

      <View style={styles.gauge}>
        <View style={[styles.bar, { backgroundColor: palette.key }]}>
          <View style={[styles.segment, { flex: usedRatio, backgroundColor: palette.accent }]} />
          <View style={[styles.segment, styles.coming, { flex: comingRatio, backgroundColor: palette.warning }]} />
          <View style={{ flex: Math.max(0, 1 - usedRatio - comingRatio) }} />
        </View>
        {/* Today, against the year. */}
        <View style={[styles.today, { left: `${todayRatio * 100}%`, backgroundColor: palette.text }]} />
      </View>
      <View style={styles.axis}>
        <Text style={[styles.axisText, { color: palette.textFaint }]}>{monthShort(start)}</Text>
        <Text style={[styles.axisText, styles.axisToday, { color: palette.text, left: `${todayRatio * 100}%` }]}>
          ▲ today
        </Text>
        <Text style={[styles.axisText, { color: palette.textFaint }]}>{monthShort(end)}</Text>
      </View>

      <View style={styles.legend}>
        <LegendRow colour={palette.accent} label="Spent" value={formatAmount(allowance.used)} palette={palette} />
        {committed > 0 ? (
          <LegendRow
            colour={palette.warning}
            faded
            label="Subscriptions still to come"
            value={formatAmount(allowance.committedTotal, { estimated: true })}
            palette={palette}
          />
        ) : null}
      </View>

      {allowance.exhaustionDate ? (
        <View style={[styles.callout, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          <Text style={[styles.calloutTitle, { color: palette.warning }]}>
            At this pace it runs out {describeDate(allowance.exhaustionDate)}
          </Text>
          <Text style={[styles.calloutBody, { color: palette.dim }]}>
            {failingNames.length > 0
              ? `${failingNames.join(', ')} renew${failingNames.length === 1 ? 's' : ''} after that and may be declined.`
              : 'Foreign payments after that date may be declined.'}
          </Text>
        </View>
      ) : committed > 0 ? (
        <Text style={[styles.caption, { color: palette.dim, marginTop: spacing.md }]}>
          With the subscriptions to come, the year ends on {formatAmount(allowance.projectedTotal)} — within the
          ceiling.
        </Text>
      ) : null}

      {allowance.rulesWithoutRate.length > 0 ? (
        <Text style={[styles.caption, { color: palette.warning, marginTop: spacing.sm }]}>
          {allowance.rulesWithoutRate.length} subscription{allowance.rulesWithoutRate.length === 1 ? '' : 's'} not
          valued yet, so what is to come is a floor.
        </Text>
      ) : null}
    </View>
  );
}

function LegendRow({
  colour,
  label,
  value,
  faded,
  palette,
}: {
  colour: string;
  label: string;
  value: string;
  faded?: boolean;
  palette: Palette;
}) {
  return (
    <View style={styles.legendRow}>
      <View style={[styles.swatch, { backgroundColor: colour }, faded ? styles.coming : null]} />
      <Text style={[styles.legendLabel, { color: palette.dim }]}>{label}</Text>
      <Text style={[styles.legendValue, { color: palette.text }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  eyebrow: { fontSize: typeScale.sm, fontWeight: '500' },
  hero: { fontSize: 34, fontWeight: '700', letterSpacing: -0.8, marginTop: 2, fontVariant: ['tabular-nums'] },
  heroUnit: { fontSize: typeScale.md, fontWeight: '600', letterSpacing: 0 },
  caption: { fontSize: typeScale.sm, lineHeight: 19 },

  gauge: { marginTop: spacing.lg, justifyContent: 'center' },
  bar: { height: 26, borderRadius: radii.sm, overflow: 'hidden', flexDirection: 'row' },
  segment: { height: '100%' },
  coming: { opacity: 0.55 },
  today: { position: 'absolute', width: 2, height: 34, marginLeft: -1, borderRadius: 1 },
  axis: { height: 18, marginTop: 4, flexDirection: 'row', justifyContent: 'space-between' },
  axisText: { fontSize: typeScale.xs },
  axisToday: { position: 'absolute', transform: [{ translateX: -24 }], fontWeight: '600' },

  legend: { marginTop: spacing.sm, gap: 6 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  swatch: { width: 10, height: 10, borderRadius: 3 },
  legendLabel: { flex: 1, fontSize: typeScale.sm },
  legendValue: { fontSize: typeScale.sm, fontWeight: '600', fontVariant: ['tabular-nums'] },

  callout: { marginTop: spacing.md, borderWidth: 1, borderRadius: radii.md, padding: spacing.md, gap: 3 },
  calloutTitle: { fontSize: typeScale.sm, fontWeight: '700' },
  calloutBody: { fontSize: typeScale.sm, lineHeight: 19 },
});
