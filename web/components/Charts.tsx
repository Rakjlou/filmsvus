import { useEffect, useId, useRef, useState } from 'react';
import type { Stats } from '../types.ts';
import { number } from '../format.ts';

function useChartWidth() {
  const ref = useRef<HTMLElement>(null);
  const [width, setWidth] = useState(480);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => { const size = element.getBoundingClientRect().width; if (size > 0) setWidth(Math.max(200, Math.round(size))); };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

export function BarChart({ title, data, description }: { title: string; data: { label: string; value: number }[]; description?: string }) {
  const id = useId();
  const { ref, width } = useChartWidth();
  const maximum = Math.max(1, ...data.map(d => d.value));
  const height = 255, left = 36, bottom = 212, plotWidth = width - left - 12;
  const step = plotWidth / Math.max(data.length, 1), bar = Math.min(48, step * .65);
  const every = Math.max(1, Math.ceil(data.length / Math.max(4, Math.floor(plotWidth / 38))));
  return <figure ref={ref} className="chart"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={`${id}-title ${id}-desc`}><title id={`${id}-title`}>{title}</title><desc id={`${id}-desc`}>{description ?? data.map(d => `${d.label} : ${d.value}`).join(' ; ')}</desc>
    {[0, .5, 1].map(fraction => <g key={fraction}><line className="chart-grid" x1={left} x2={width - 8} y1={bottom - fraction * 180} y2={bottom - fraction * 180} /><text className="chart-label" x={left - 8} y={bottom - fraction * 180 + 4} textAnchor="end">{number(maximum * fraction)}</text></g>)}
    {data.map((d, i) => <g key={d.label}><rect className="chart-bar" x={left + step * i + (step - bar) / 2} y={bottom - d.value / maximum * 180} width={bar} height={d.value / maximum * 180} rx="3"><title>{d.label} : {d.value} film{d.value > 1 ? 's' : ''}</title></rect>{step >= 28 && d.value > 0 && <text className="chart-label chart-value" x={left + step * (i + .5)} y={bottom - d.value / maximum * 180 - 8} textAnchor="middle">{d.value}</text>}{(i % every === 0 && (i < data.length - 1 - every / 2 || i === data.length - 1) || i === data.length - 1) && <text className="chart-label" x={left + step * (i + .5)} y={bottom + 25} textAnchor="middle">{d.label}</text>}</g>)}
  </svg><details className="chart-data"><summary>Consulter les données</summary><table><caption className="sr-only">{title}</caption><thead><tr><th scope="col">Période / note</th><th scope="col">Films</th></tr></thead><tbody>{data.map(d => <tr key={d.label}><th scope="row">{d.label}</th><td>{d.value}</td></tr>)}</tbody></table></details></figure>;
}
export function ScatterChart({ stats }: { stats: Stats }) {
  const id = useId();
  const { ref, width } = useChartWidth();
  const left = 36, right = width - 16, plot = right - left;
  return <figure ref={ref} className="chart"><svg viewBox={`0 0 ${width} 320`} role="img" aria-labelledby={`${id}-title ${id}-desc`}><title id={`${id}-title`}>Notre note et celle d’IMDb</title><desc id={`${id}-desc`}>{stats.imdb_pairs.length} films. Axe horizontal : moyenne du couple de 0 à 10. Axe vertical : IMDb de 0 à 10. Corrélation : {number(stats.imdb_correlation, 2)}.</desc>
    {[0, 2, 4, 6, 8, 10].map(value => <g key={value}><line className="chart-grid" x1={left} x2={right} y1={265 - value * 23} y2={265 - value * 23} /><text className="chart-label" x={left - 10} y={270 - value * 23} textAnchor="end">{value}</text></g>)}
    {[0, 2, 4, 6, 8, 10].map(value => <text key={value} className="chart-label" x={left + value / 10 * plot} y="287" textAnchor="middle">{value}</text>)}
    <text className="chart-label" x={left + plot / 2} y="313" textAnchor="middle">Notre moyenne /10</text><text className="chart-label" x="12" y="20">IMDb /10</text>
    {stats.imdb_pairs.map(p => <circle key={p.id} className="scatter-point" cx={left + p.avg / 10 * plot} cy={265 - p.imdb_rating * 23} r="4"><title>{p.title} : nous {number(p.avg)}, IMDb {number(p.imdb_rating)}</title></circle>)}
  </svg><details className="chart-data"><summary>Consulter les films comparés</summary><table><thead><tr><th scope="col">Film</th><th scope="col">Nous</th><th scope="col">IMDb</th></tr></thead><tbody>{stats.imdb_pairs.map(p => <tr key={p.id}><th scope="row">{p.title}</th><td>{number(p.avg)}</td><td>{number(p.imdb_rating)}</td></tr>)}</tbody></table></details></figure>;
}
