// SVG world map: d3-geo Equal Earth projection, d3-zoom pan/pinch, tap handling.
// Rendering only; all game rules live in src/logic.
import { geoEqualEarth, geoPath, type GeoProjection } from 'd3-geo';
import { select, type Selection } from 'd3-selection';
import { zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from 'd3-zoom';
import { feature } from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-specification';
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import type { CountryData } from '../logic/types.ts';

export interface MapState {
  visited: ReadonlySet<string>;
  start: string;
  selected: string | null;
  /** Shown at the end of the game. */
  target: string | null;
  route: string[] | null;
  /** Labels always shown regardless of size (start, latest guess, target). */
  pinned: string[];
  /** Visited countries only: 0..4, how strongly they match the revealed hints (drawn as shades of green). */
  shades: ReadonlyMap<string, number>;
  /** Visited countries that touch the (hidden) destination: outlined so they stand out. */
  borderTarget: ReadonlySet<string>;
  /** Hint helper: every country that fits the chosen hint, drawn in yellow. Empty when the helper is off. */
  hinted?: ReadonlySet<string>;
}

const HIT_RADIUS_PX = 11; // minimum invisible tap target around tiny countries
const LABEL_PX = 12;
/** Hide a visited country's label until its shape is at least this wide on screen. */
const LABEL_MIN_WIDTH_PX = 34;

export class WorldMap {
  private svg: Selection<SVGSVGElement, unknown, null, undefined>;
  private root: Selection<SVGGElement, unknown, null, undefined>;
  private features: Feature<Geometry, { id: string }>[];
  private projection!: GeoProjection;
  private zoomer!: ZoomBehavior<SVGSVGElement, unknown>;
  private t: ZoomTransform = zoomIdentity;
  private state: MapState | null = null;
  private data: CountryData;
  private container: HTMLElement;
  private onTap: (id: string | null) => void;

  constructor(container: HTMLElement, topo: Topology, data: CountryData, onTap: (id: string | null) => void) {
    this.container = container;
    this.data = data;
    this.onTap = onTap;
    const fc = feature(topo, topo.objects.countries as GeometryCollection) as unknown as FeatureCollection<Geometry>;
    this.features = fc.features.map((f) => ({ ...f, properties: { id: String(f.id) } }));
    this.svg = select(container).append('svg').attr('class', 'map-svg').attr('role', 'img').attr('aria-label', 'World map');
    this.root = this.svg.append('g');
    this.svg.on('click', (ev: MouseEvent) => {
      const el = (ev.target as Element).closest('[data-id]');
      this.onTap(el ? el.getAttribute('data-id') : null);
    });
    this.layout();
    let t: number | undefined;
    new ResizeObserver(() => { clearTimeout(t); t = window.setTimeout(() => this.layout(), 120); }).observe(container);
  }

  private widths = new Map<string, number>();
  private lastW = 0;
  private lastH = 0;

  private layout() {
    const w = this.container.clientWidth || 360;
    const h = this.container.clientHeight || 480;
    if (w === this.lastW && h === this.lastH) return;
    this.svg.attr('viewBox', `0 0 ${w} ${h}`).attr('width', w).attr('height', h);
    // Height-only changes (hint list growing, card opening) must not reset the player's zoom:
    // keep the projection and shift the view to keep the same map point centred.
    if (w === this.lastW && this.lastH) {
      const dy = (h - this.lastH) / 2;
      this.lastH = h;
      this.svg.call(this.zoomer.transform, zoomIdentity.translate(this.t.x, this.t.y + dy).scale(this.t.k));
      return;
    }
    this.lastW = w;
    this.lastH = h;
    const fitTo = { type: 'FeatureCollection', features: this.features.filter((f) => f.properties.id !== 'ATA') } as FeatureCollection;
    this.projection = geoEqualEarth().fitExtent([[6, 6], [w - 6, h - 6]], fitTo);
    const path = geoPath(this.projection);
    const [[x0, y0], [x1, y1]] = path.bounds(fitTo);
    for (const f of this.features) { const b = path.bounds(f); this.widths.set(f.properties.id, b[1][0] - b[0][0]); }

    this.root.selectAll('*').remove();
    this.root.append('rect').attr('class', 'ocean').attr('x', -w * 4).attr('y', -h * 4).attr('width', w * 9).attr('height', h * 9);
    this.root.append('g').attr('class', 'countries')
      .selectAll('path').data(this.features).join('path')
      .attr('d', (f) => path(f) ?? '')
      .attr('data-id', (f) => f.properties.id)
      .attr('class', (f) => `country ${this.data.countries[f.properties.id]?.playable ? 'playable' : 'excluded'}`);
    // Equator and the tropics: purely decorative, drawn under labels and never tappable.
    const lineAt = (lat: number): [number, number][] => Array.from({ length: 181 }, (_, i) => [-180 + i * 2, lat]);
    const parallels: [string, number][] = [['Tropic of Cancer', 23.4366], ['Equator', 0], ['Tropic of Capricorn', -23.4366]];
    this.root.append('g').attr('class', 'parallels')
      .selectAll('path').data(parallels).join('path')
      .attr('d', ([, lat]) => path({ type: 'LineString', coordinates: lineAt(lat) }) ?? '');
    this.root.append('g').attr('class', 'parallel-labels')
      .selectAll('text').data(parallels).join('text')
      .attr('x', ([, lat]) => this.projection([-176, lat])![0] + 2)
      .attr('y', ([, lat]) => this.projection([-176, lat])![1] - 2)
      .text(([name]) => name);
    this.root.append('g').attr('class', 'route');
    this.root.append('g').attr('class', 'labels');
    // Invisible minimum hit targets for micro-states (drawn on top so they win the tap).
    const tiny = Object.values(this.data.countries).filter((c) => c.playable && c.tiny);
    this.root.append('g').attr('class', 'hits')
      .selectAll('circle').data(tiny).join('circle')
      .attr('data-id', (c) => c.id)
      .attr('cx', (c) => this.projection(c.label)![0])
      .attr('cy', (c) => this.projection(c.label)![1]);

    this.zoomer = zoom<SVGSVGElement, unknown>()
      .scaleExtent([1, 3000])
      .translateExtent([[x0 - 40, y0 - 40], [x1 + 40, y1 + 40]])
      .clickDistance(8)
      .on('zoom', (ev: { transform: ZoomTransform }) => this.applyTransform(ev.transform));
    this.svg.call(this.zoomer).on('dblclick.zoom', null);
    this.svg.call(this.zoomer.transform, zoomIdentity);
    if (this.state) this.render(this.state);
  }

  private applyTransform(t: ZoomTransform) {
    this.t = t;
    this.root.attr('transform', t.toString());
    this.root.select('.labels').attr('font-size', LABEL_PX / t.k);
    this.root.select('.parallel-labels').attr('font-size', 9 / t.k);
    const pinned = new Set(this.state?.pinned ?? []);
    this.root.selectAll<SVGTextElement, string>('.labels text')
      .attr('stroke-width', 3 / t.k)
      .attr('display', (id) => (pinned.has(id) || (this.widths.get(id) ?? 0) * t.k >= LABEL_MIN_WIDTH_PX ? null : 'none'));
    this.root.selectAll('.hits circle').attr('r', HIT_RADIUS_PX / t.k);
    this.root.select('.route path').attr('stroke-width', 2.5 / t.k).attr('stroke-dasharray', `${6 / t.k} ${4 / t.k}`);
    this.root.selectAll('.route circle').attr('r', 3.5 / t.k);
  }

  render(state: MapState) {
    this.state = state;
    const { visited, selected, target, start } = state;
    this.root.selectAll<SVGPathElement, Feature<Geometry, { id: string }>>('.countries path')
      .classed('visited', (f) => visited.has(f.properties.id))
      .attr('data-shade', (f) => (visited.has(f.properties.id) ? String(state.shades.get(f.properties.id) ?? 0) : null))
      .classed('start', (f) => f.properties.id === start)
      .classed('selected', (f) => f.properties.id === selected)
      .classed('hinted', (f) => !!state.hinted?.has(f.properties.id))
      .classed('borders-target', (f) => state.borderTarget.has(f.properties.id))
      .classed('target', (f) => f.properties.id === target);
    // Bring the selected shape to the front so its outline is not hidden by neighbours.
    this.root.selectAll<SVGPathElement, Feature<Geometry, { id: string }>>('.countries path')
      .filter((f) => f.properties.id === selected || state.borderTarget.has(f.properties.id)).raise();

    // Names only for visited countries (start included) and, at the end, the target.
    const named = [...visited];
    if (target && !visited.has(target)) named.push(target);
    this.root.select('.labels').selectAll('text').data(named, (d) => d as string).join('text')
      .attr('x', (id) => this.projection(this.data.countries[id].label)![0])
      .attr('y', (id) => this.projection(this.data.countries[id].label)![1])
      .attr('text-anchor', 'middle').attr('dy', '0.35em')
      .text((id) => this.data.countries[id].name);

    const route = this.root.select('.route');
    route.selectAll('*').remove();
    if (state.route && state.route.length > 1) {
      const pts = state.route.map((id) => this.projection(this.data.countries[id].label)!);
      route.append('path').attr('d', `M${pts.map((p) => p.join(',')).join('L')}`);
      route.selectAll('circle').data(pts).join('circle').attr('cx', (p) => p[0]).attr('cy', (p) => p[1]);
    }
    this.applyTransform(this.t);
  }

  /** Zoom so the given countries fill the view. */
  zoomTo(ids: string[], duration = 600) {
    const path = geoPath(this.projection);
    const w = this.container.clientWidth, h = this.container.clientHeight;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const add = (a: number, b: number, c: number, d: number) => { x0 = Math.min(x0, a); y0 = Math.min(y0, b); x1 = Math.max(x1, c); y1 = Math.max(y1, d); };
    for (const id of new Set(ids)) {
      const f = this.features.find((x) => x.properties.id === id);
      if (!f) continue;
      const [[a, b], [c, d]] = path.bounds(f);
      if (c - a > w * 0.45) {
        // Shapes crossing the antimeridian (Russia, USA) have a world-wide box: frame their label instead.
        const [lx, ly] = this.projection(this.data.countries[id].label)!;
        const r = w * 0.12;
        add(lx - r, ly - r * 0.6, lx + r, ly + r * 0.6);
      } else add(a, b, c, d);
    }
    if (!isFinite(x0)) return;
    const k = Math.min(40, Math.max(1, 0.82 / Math.max((x1 - x0) / w, (y1 - y0) / h, 1e-6)));
    const t = zoomIdentity.translate(w / 2, h / 2).scale(k).translate(-(x0 + x1) / 2, -(y0 + y1) / 2);
    this.animateTo(t, duration);
  }

  /** True if the country's shape lies fully inside the visible map area (minus a bottom inset). */
  isInView(id: string, margin = 12, bottomInset = 0): boolean {
    const f = this.features.find((x) => x.properties.id === id);
    if (!f) return true;
    const [[x0, y0], [x1, y1]] = geoPath(this.projection).bounds(f);
    const { x, y, k } = this.t;
    const w = this.container.clientWidth, h = this.container.clientHeight - bottomInset;
    return x0 * k + x >= margin && y0 * k + y >= margin + 40 && x1 * k + x <= w - margin && y1 * k + y <= h - margin;
  }

  /**
   * If the country is hidden (e.g. under the info card), glide it into the free area above
   * `bottomInset` px, keeping the zoom level unless the shape would not fit.
   */
  revealCountry(id: string, bottomInset: number) {
    if (this.isInView(id, 12, bottomInset)) return;
    const f = this.features.find((x) => x.properties.id === id);
    if (!f) return;
    const path = geoPath(this.projection);
    const w = this.container.clientWidth, h = Math.max(80, this.container.clientHeight - bottomInset);
    let [[x0, y0], [x1, y1]] = path.bounds(f);
    if (x1 - x0 > w * 0.45) { // antimeridian-crossing shapes: use the label point
      const [lx, ly] = this.projection(this.data.countries[id].label)!;
      [x0, y0, x1, y1] = [lx - 20, ly - 20, lx + 20, ly + 20];
    }
    const fit = 0.8 / Math.max((x1 - x0) / w, (y1 - y0) / (h - 40), 1e-6);
    const k = Math.min(this.t.k, fit) < 1 ? 1 : Math.min(Math.max(this.t.k, 1), Math.max(fit, 1));
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    this.animateTo(zoomIdentity.translate(w / 2 - cx * k, 20 + h / 2 - cy * k).scale(k), 450);
  }

  resetZoom() {
    this.animateTo(zoomIdentity, 500);
  }

  /** Small tween (no d3-transition dependency): log-interpolate scale, linear translate. */
  private animateTo(to: ZoomTransform, duration: number) {
    const from = this.t;
    const t0 = performance.now();
    const ease = (x: number) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / duration), e = ease(p);
      const k = Math.exp(Math.log(from.k) + (Math.log(to.k) - Math.log(from.k)) * e);
      // Interpolate the map point at the view centre so the motion stays straight.
      const w = this.container.clientWidth / 2, h = this.container.clientHeight / 2;
      const cx0 = (w - from.x) / from.k, cy0 = (h - from.y) / from.k;
      const cx1 = (w - to.x) / to.k, cy1 = (h - to.y) / to.k;
      const cx = cx0 + (cx1 - cx0) * e, cy = cy0 + (cy1 - cy0) * e;
      this.svg.call(this.zoomer.transform, zoomIdentity.translate(w - cx * k, h - cy * k).scale(k));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
}
