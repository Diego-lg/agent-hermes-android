/**
 * MarkdownText — a small, dependency-free markdown renderer tuned for the
 * chat bubble. It is intentionally forgiving: it renders partial / in-flight
 * markdown (mid-stream) without throwing, and falls back to plain text for
 * anything it doesn't recognize.
 *
 * Supported: fenced code blocks, ATX headings (#/##/###), unordered &
 * ordered lists, blockquotes, horizontal rules, and inline **bold**,
 * *italic*, `code`, and [links](url). Everything is selectable.
 */
import React from 'react';
import {View, Text, ScrollView, Linking, Platform} from 'react-native';
import {useTheme} from './theme.tsx';

interface Props {
  text: string;
  color?: string;
  fontFamily?: string;
  muted?: boolean;
}

const monoFont = Platform.select({ios: 'Menlo', android: 'monospace', default: 'monospace'});

type Seg = {t: string; b?: boolean; i?: boolean; c?: boolean; href?: string};

/** Tokenize a single line of text into styled segments. */
function inlineSegments(src: string): Seg[] {
  const segs: Seg[] = [];
  let i = 0;
  const push = (s: Partial<Seg> & {t: string}) => {
    if (s.t) segs.push(s as Seg);
  };
  while (i < src.length) {
    if (src[i] === '`') {
      const end = src.indexOf('`', i + 1);
      if (end > i) { push({t: src.slice(i + 1, end), c: true}); i = end + 1; continue; }
    }
    if (src[i] === '[') {
      const close = src.indexOf(']', i);
      if (close > i && src[close + 1] === '(') {
        const paren = src.indexOf(')', close + 2);
        if (paren > close) {
          push({t: src.slice(i + 1, close), href: src.slice(close + 2, paren)});
          i = paren + 1; continue;
        }
      }
    }
    if (src.startsWith('**', i) || src.startsWith('__', i)) {
      const marker = src.slice(i, i + 2);
      const end = src.indexOf(marker, i + 2);
      if (end > i) { push({t: src.slice(i + 2, end), b: true}); i = end + 2; continue; }
    }
    if (src[i] === '*' || src[i] === '_') {
      const marker = src[i];
      const end = src.indexOf(marker, i + 1);
      if (end > i && src[i + 1] !== ' ') { push({t: src.slice(i + 1, end), i: true}); i = end + 1; continue; }
    }
    let next = i + 1;
    while (next < src.length && !'`[*_'.includes(src[next])) next++;
    push({t: src.slice(i, next)});
    i = next;
  }
  return segs;
}

const InlineLine: React.FC<{
  src: string; color: string; fontFamily?: string;
  size: number; lineHeight: number; accent: string;
  codeBg: string; codeColor: string; weight?: any;
}> = ({src, color, fontFamily, size, lineHeight, accent, codeBg, codeColor, weight}) => {
  const segs = inlineSegments(src);
  return (
    <Text selectable style={{color, fontSize: size, lineHeight, fontFamily, fontWeight: weight}}>
      {segs.map((s, idx) => {
        if (s.c) {
          return (
            <Text key={idx} style={{fontFamily: monoFont, fontSize: size - 1, color: codeColor, backgroundColor: codeBg}}>
              {' '}{s.t}{' '}
            </Text>
          );
        }
        const style: any = {};
        if (s.b) style.fontWeight = '700';
        if (s.i) style.fontStyle = 'italic';
        if (s.href) {
          style.color = accent; style.textDecorationLine = 'underline';
          return (
            <Text key={idx} style={style} onPress={() => Linking.openURL(s.href!).catch(() => {})}>
              {s.t}
            </Text>
          );
        }
        return <Text key={idx} style={style}>{s.t}</Text>;
      })}
    </Text>
  );
};

export default function MarkdownText({text, color, fontFamily, muted}: Props) {
  const {palette, spacing} = useTheme();
  const baseColor = color ?? palette.text;
  const size = muted ? 12 : 14;
  const lineHeight = muted ? 18 : 22;
  const codeBg = palette.surfaceAlt;
  const codeColor = palette.type === 'mono' ? palette.text : palette.accentDim;

  const src = text ?? '';
  const lines = src.split('\n');
  const blocks: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  const inline = (s: string, extra?: {size?: number; color?: string; weight?: any}) => (
    <InlineLine
      key={key++}
      src={s}
      color={extra?.color ?? baseColor}
      fontFamily={fontFamily}
      size={extra?.size ?? size}
      lineHeight={(extra?.size ?? size) + 8}
      accent={palette.accent}
      codeBg={codeBg}
      codeColor={codeColor}
      weight={extra?.weight}
    />
  );

  while (i < lines.length) {
    const line = lines[i];

    const fence = line.match(/^\s*```(\w*)\s*$/);
    if (fence) {
      const lang = fence[1];
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) { body.push(lines[i]); i++; }
      i++;
      blocks.push(
        <View key={key++} style={{backgroundColor: palette.surfaceAlt, borderWidth: 1, borderColor: palette.border, borderRadius: 4, marginVertical: spacing.xs}}>
          {lang ? (
            <Text style={{fontFamily: monoFont, fontSize: 9, color: palette.textDim, paddingHorizontal: 10, paddingTop: 6, letterSpacing: 1, textTransform: 'uppercase'}}>{lang}</Text>
          ) : null}
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <Text selectable style={{fontFamily: monoFont, fontSize: 12, lineHeight: 18, color: palette.text, padding: 10}}>{body.join('\n')}</Text>
          </ScrollView>
        </View>,
      );
      continue;
    }

    if (line.trim() === '') { i++; continue; }

    if (/^\s*([-*_])\1\1+\s*$/.test(line)) {
      blocks.push(<View key={key++} style={{height: 1, backgroundColor: palette.border, marginVertical: spacing.sm}} />);
      i++;
      continue;
    }

    const h = line.match(/^\s*(#{1,3})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      blocks.push(
        <View key={key++} style={{marginTop: spacing.sm, marginBottom: spacing.xxs}}>
          {inline(h[2], {size: level === 1 ? size + 5 : level === 2 ? size + 3 : size + 1, weight: '700'})}
        </View>,
      );
      i++;
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) { quote.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
      blocks.push(
        <View key={key++} style={{borderLeftWidth: 2, borderLeftColor: palette.accent, paddingLeft: spacing.md, marginVertical: spacing.xs}}>
          {inline(quote.join(' '), {color: palette.textMuted})}
        </View>,
      );
      continue;
    }

    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      const items: {indent: number; ordered: boolean; marker: string; body: string}[] = [];
      while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
        const m = lines[i].match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/)!;
        items.push({indent: Math.floor(m[1].length / 2), ordered: /\d/.test(m[2]), marker: m[2], body: m[3]});
        i++;
      }
      blocks.push(
        <View key={key++} style={{marginVertical: spacing.xxs}}>
          {items.map((it, idx) => (
            <View key={idx} style={{flexDirection: 'row', paddingLeft: spacing.sm + it.indent * spacing.md, marginVertical: 1}}>
              <Text style={{color: palette.accent, fontSize: size, lineHeight: size + 8, width: it.ordered ? 22 : 14, fontFamily}}>
                {it.ordered ? it.marker : '\u2022'}
              </Text>
              <View style={{flex: 1}}>{inline(it.body)}</View>
            </View>
          ))}
        </View>,
      );
      continue;
    }

    // paragraph — merge consecutive plain lines
    const para: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^\s*```/.test(lines[i]) &&
      !/^\s*(#{1,3})\s/.test(lines[i]) &&
      !/^\s*>\s?/.test(lines[i]) &&
      !/^\s*([-*+]|\d+\.)\s+/.test(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    blocks.push(
      <View key={key++} style={{marginVertical: spacing.xxs}}>
        {inline(para.join(' '))}
      </View>,
    );
  }

  return <View>{blocks}</View>;
}
