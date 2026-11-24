 

import { fmtClock, fmtDay } from '../format.js';
import { STATUS_LABEL } from './components.js';
import { h, replace, s } from './dom.js';

const PAD = { l: 56, r: 12, t: 12, b: 26 };

function niceScale(max, targetTicks = 4) {
  const safeMax = max > 0 ? max : 1;
  const rough = safeMax / targetTicks;
  const pow = 10 ** Math.floor(Math.log10(rough));
  const f = rough / pow;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * pow;
  const top = Math.ceil(safeMax / step - 1e-9) * step;
  const ticks = [];
  for (let i = 0; i * step <= top + step / 1000; i++) ticks.push(i * step);
  return { max: top, ticks };
}

export function createTimeChart(container, { mode = 'line', height = 190, yFormat = String, label = 'Chart' }) {
  container.classList.add('chart');

  let data = { times: [], series: [], from: 0, to: 1, bucketMs: 60_000, limit: null, minTop: 0, longRange: false };
  let drawnWidth = 0;

  const tip = h('div', { class: 'chart-tip', hidden: true });

  function formatTime(ms, long = false) {
    if (data.longRange) return long ? `${fmtDay(ms)}, ${fmtClock(ms)}` : fmtDay(ms);
    return fmtClock(ms);
  }

  function draw() {
    const width = Math.max(260, Math.floor(container.clientWidth));
    drawnWidth = width;
    const plotW = width - PAD.l - PAD.r;
    const plotH = height - PAD.t - PAD.b;
    const { times, series, from, to, limit } = data;
    const plotted = series.filter((item) => item.plot !== false);

    const svg = s('svg', { width, height, viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': label });

    const hasData = plotted.some((item) => item.values.some((v) => v != null));
    if (!hasData) {
      svg.append(s('text', { x: width / 2, y: height / 2, 'text-anchor': 'middle', class: 'chart-empty' }, 'No readings in this period'));
      replace(container, svg, tip);
      return;
    }

    let top;
    if (mode === 'bars') {
      top = Math.max(0, ...times.map((_, i) => plotted.reduce((sum, item) => sum + (item.values[i] ?? 0), 0)));
    } else {
      top = Math.max(0, ...plotted.flatMap((item) => item.values.filter((v) => v != null)));
    }
    if (limit) top = Math.max(top, limit.value * 1.08);
    top = Math.max(top, data.minTop);
    const scale = niceScale(top);

    const x = (t) => PAD.l + ((t - from) / (to - from)) * plotW;
    const y = (v) => PAD.t + plotH - (v / scale.max) * plotH;

    // grid and y axis
    for (const tick of scale.ticks) {
      svg.append(
        s('line', { x1: PAD.l, x2: width - PAD.r, y1: y(tick), y2: y(tick), class: tick === 0 ? 'chart-axis' : 'chart-grid' }),
        s('text', { x: PAD.l - 8, y: y(tick) + 4, 'text-anchor': 'end', class: 'chart-tick' }, yFormat(tick)),
      );
    }

    // x axis labels
    const xTicks = width < 420 ? 3 : 5;
    for (let i = 0; i < xTicks; i++) {
      const t = from + ((to - from) * i) / (xTicks - 1);
      const anchor = i === 0 ? 'start' : i === xTicks - 1 ? 'end' : 'middle';
      svg.append(s('text', { x: x(t), y: height - 6, 'text-anchor': anchor, class: 'chart-tick' }, formatTime(t)));
    }

    if (limit) {
      svg.append(
        s('line', { x1: PAD.l, x2: width - PAD.r, y1: y(limit.value), y2: y(limit.value), class: 'chart-limit' }),
        s('text', { x: width - PAD.r - 2, y: y(limit.value) - 4, 'text-anchor': 'end', class: 'chart-limit-label' }, limit.label),
      );
    }

    const barW = Math.max(1, (plotW * data.bucketMs) / (to - from) - 1);

    if (mode === 'bars') {
      times.forEach((t, i) => {
        let base = 0;
        for (const item of plotted) {
          const v = item.values[i] ?? 0;
          if (v <= 0) continue;
          const barH = (v / scale.max) * plotH;
          svg.append(s('rect', { x: x(t), y: y(base + v), width: barW, height: barH, fill: item.color }));
          base += v;
        }
      });
    } else {
      for (const item of plotted) {
        let d = '';
        let pen = false;
        item.values.forEach((v, i) => {
          if (v == null) {
            pen = false;
            return;
          }
          d += `${pen ? 'L' : 'M'}${x(times[i]).toFixed(1)} ${y(v).toFixed(1)}`;
          pen = true;
        });
        svg.append(s('path', { d, fill: 'none', stroke: item.color, 'stroke-width': 1.8, 'stroke-linejoin': 'round' }));

        // a reading with nothing on either side would not show up as a path
        item.values.forEach((v, i) => {
          if (v != null && item.values[i - 1] == null && item.values[i + 1] == null) {
            svg.append(s('circle', { cx: x(times[i]), cy: y(v), r: 2.2, fill: item.color }));
          }
        });
      }
    }

    // hover layer
    const guide = s('line', { y1: PAD.t, y2: PAD.t + plotH, class: 'chart-guide', visibility: 'hidden' });
    const dots = mode === 'line' ? plotted.map((item) => s('circle', { r: 3.5, fill: item.color, stroke: '#fff', 'stroke-width': 1.5, visibility: 'hidden' })) : [];
    const overlay = s('rect', { x: PAD.l, y: PAD.t, width: plotW, height: plotH, fill: 'transparent' });

    overlay.addEventListener('pointermove', (event) => {
      if (!times.length) return;
      const box = svg.getBoundingClientRect();
      const t = from + ((event.clientX - box.left - PAD.l) / plotW) * (to - from);
      let nearest = 0;
      for (let i = 1; i < times.length; i++) {
        if (Math.abs(times[i] - t) < Math.abs(times[nearest] - t)) nearest = i;
      }
      const cx = x(times[nearest]) + (mode === 'bars' ? barW / 2 : 0);
      guide.setAttribute('x1', cx);
      guide.setAttribute('x2', cx);
      guide.setAttribute('visibility', 'visible');
      plotted.forEach((item, k) => {
        const v = item.values[nearest];
        if (!dots[k]) return;
        if (v == null) return dots[k].setAttribute('visibility', 'hidden');
        dots[k].setAttribute('cx', cx);
        dots[k].setAttribute('cy', y(v));
        dots[k].setAttribute('visibility', 'visible');
      });

      replace(
        tip,
        h('div', { class: 'chart-tip-time' }, formatTime(times[nearest], true)),
        series.map((item) =>
          h(
            'div',
            { class: 'chart-tip-row' },
            h('span', null, h('span', { class: 'chart-tip-swatch', style: `background:${item.color}` }), item.label),
            h('span', null, item.values[nearest] == null ? '—' : (item.fmt ?? yFormat)(item.values[nearest])),
          ),
        ),
      );
      tip.hidden = false;
      const tipW = tip.offsetWidth;
      const left = cx + 14 + tipW > width ? cx - tipW - 14 : cx + 14;
      tip.style.left = `${Math.max(0, left)}px`;
      tip.style.top = `${PAD.t}px`;
    });
    overlay.addEventListener('pointerleave', () => {
      guide.setAttribute('visibility', 'hidden');
      dots.forEach((d) => d.setAttribute('visibility', 'hidden'));
      tip.hidden = true;
    });

    svg.append(guide, ...dots, overlay);
    replace(container, svg, tip);
  }

  const observer = new ResizeObserver(() => {
    if (Math.floor(container.clientWidth) !== drawnWidth && data.times) draw();
  });
  observer.observe(container);

  return {
    update(next) {
      data = { ...data, limit: null, minTop: 0, ...next };
      draw();
    },
    destroy() {
      observer.disconnect();
    },
  };
}

/** Coloured cells, one per bucket, showing the worst status seen in each. */
export function statusStrip(points) {
  const strip = h('div', { class: 'status-strip', role: 'img', 'aria-label': 'Status over the selected period' });
  for (const point of points) {
    strip.append(
      h('span', {
        class: `strip-cell strip-${point.worst}`,
        title: `${new Date(point.t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}: ${STATUS_LABEL[point.worst]}`,
      }),
    );
  }
  return strip;
}
