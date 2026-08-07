import React from 'react';
import { View } from 'react-native';
import Svg, { Circle, Path, Line as SvgLine } from 'react-native-svg';
import { useStore } from '../store';
import { AppText } from './ui';

// A dependency-light progression line: one point per session. Enough to see the
// trend at a glance without pulling in a charting library.

export function LineChart({
  values,
  height = 160,
}: {
  values: number[];
  height?: number;
}) {
  const { theme } = useStore();
  const [width, setWidth] = React.useState(0);

  const padX = 8;
  const padY = 16;

  if (values.length === 0) {
    return (
      <View style={{ height, alignItems: 'center', justifyContent: 'center' }}>
        <AppText variant="soft">No data yet</AppText>
      </View>
    );
  }

  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;

  const innerW = Math.max(1, width - padX * 2);
  const innerH = height - padY * 2;

  const points = values.map((v, i) => {
    const x =
      values.length === 1
        ? padX + innerW / 2
        : padX + (i / (values.length - 1)) * innerW;
    const y = padY + innerH - ((v - min) / span) * innerH;
    return { x, y };
  });

  const linePath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(' ');

  // A soft fill under the line for a bit of depth.
  const areaPath =
    points.length > 1
      ? `${linePath} L${points[points.length - 1].x.toFixed(1)},${(
          padY + innerH
        ).toFixed(1)} L${points[0].x.toFixed(1)},${(padY + innerH).toFixed(1)} Z`
      : '';

  return (
    <View
      style={{ height }}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
    >
      {width > 0 ? (
        <Svg width={width} height={height}>
          {/* baseline */}
          <SvgLine
            x1={padX}
            y1={padY + innerH}
            x2={padX + innerW}
            y2={padY + innerH}
            stroke={theme.colors.cardBorder}
            strokeWidth={1}
          />
          {areaPath ? (
            <Path d={areaPath} fill={theme.colors.accentSoft} />
          ) : null}
          <Path
            d={linePath}
            fill="none"
            stroke={theme.colors.accent}
            strokeWidth={2.5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {points.map((p, i) => (
            <Circle
              key={i}
              cx={p.x}
              cy={p.y}
              r={i === points.length - 1 ? 4.5 : 3}
              fill={i === points.length - 1 ? theme.colors.accent : theme.colors.card}
              stroke={theme.colors.accent}
              strokeWidth={2}
            />
          ))}
        </Svg>
      ) : null}
    </View>
  );
}
