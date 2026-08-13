import type { RainfallDay } from '../api';
import { precipitationColor } from '../domain/colormap';
import { computeMonthlyProfile, type RainfallProfileEntry } from '../domain/rainfallProfile';
import {
  floodRunStore,
  loadRainfallEvents,
  rainfallEventsStore,
  runSelectedRainfallEvent,
  selectRainfallDate,
} from '../state';
import { button, statusPill } from '../ui/primitives';
import { precipitationGlyph } from '../ui/precipitationGlyph';
import { clear, h, mount } from '../utils/dom';
import { createPanelShell } from './panelShell';
import type { PanelController } from './types';

const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTH_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});
const DAY_FORMATTER = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});

function monthKeyOf(date: string): string {
  return date.slice(0, 7);
}

function shiftMonthKey(monthKey: string, delta: number): string {
  const year = Number(monthKey.slice(0, 4));
  const monthIndex0 = Number(monthKey.slice(5, 7)) - 1;
  const shifted = new Date(Date.UTC(year, monthIndex0 + delta, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`;
}

function daysInMonth(monthKey: string): number {
  const year = Number(monthKey.slice(0, 4));
  const monthIndex0 = Number(monthKey.slice(5, 7)) - 1;
  return new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate();
}

function firstWeekday(monthKey: string): number {
  const year = Number(monthKey.slice(0, 4));
  const monthIndex0 = Number(monthKey.slice(5, 7)) - 1;
  return new Date(Date.UTC(year, monthIndex0, 1)).getUTCDay();
}

function isRunActive(status: string | undefined): boolean {
  return (
    status !== undefined && status !== 'completed' && status !== 'failed' && status !== 'cancelled'
  );
}

function monthlyProfileChart(entries: readonly RainfallProfileEntry[]): HTMLElement {
  const maxTotalMm = entries.reduce((max, entry) => Math.max(max, entry.totalMm), 0);
  return h(
    'div',
    { class: 'rainfall-profile' },
    h('span', { class: 'rainfall-profile__title' }, 'Monthly profile'),
    h(
      'div',
      { class: 'rainfall-profile__track' },
      ...entries.map((entry) => {
        const [r, g, b] = precipitationColor(entry.totalMm, maxTotalMm);
        return h('button', {
          type: 'button',
          class: `rainfall-profile__bar${entry.isSelected ? ' rainfall-profile__bar--selected' : ''}`,
          title: `${entry.date}: ${entry.totalMm.toFixed(1)} mm`,
          style: `height: ${Math.max(entry.intensity, 0.04) * 100}%; background: rgb(${r}, ${g}, ${b})`,
          onClick: () => selectRainfallDate(entry.date),
        });
      }),
    ),
  );
}

export function renderRainfallCalendarPanel(
  container: HTMLElement,
  onClose: () => void,
): PanelController {
  const shell = createPanelShell({ id: 'rainfall', title: 'Rainfall', onClose });
  mount(container, shell.element);
  shell.focus();

  let viewMonth: string | null = null;

  const render = (): void => {
    const { status, days, provenance, selectedDate, preparing, error } = rainfallEventsStore.get();
    const floodRun = floodRunStore.get();

    if (status === 'loading' || status === 'idle') {
      clear(shell.body);
      mount(shell.body, h('p', { role: 'status' }, 'Loading real rainfall record…'));
      return;
    }
    if (status === 'error') {
      clear(shell.body);
      mount(
        shell.body,
        h('p', { role: 'alert' }, error?.message ?? 'Failed to load the rainfall record.'),
      );
      return;
    }

    if (viewMonth === null) {
      viewMonth = days.length > 0 ? monthKeyOf(days[0].date) : monthKeyOf(new Date().toISOString());
    }

    const byDate = new Map<string, RainfallDay>(days.map((day) => [day.date, day]));
    const maxTotalMm = days.reduce((max, day) => Math.max(max, day.totalMm), 0);

    const monthLabel = MONTH_FORMATTER.format(new Date(`${viewMonth}-01T00:00:00Z`));
    const header = h(
      'div',
      { class: 'calendar__header' },
      button({
        label: '‹',
        title: 'Previous month',
        ariaLabel: 'Previous month',
        onClick: () => {
          viewMonth = shiftMonthKey(viewMonth as string, -1);
          render();
        },
      }),
      h('span', { class: 'calendar__month' }, monthLabel),
      button({
        label: '›',
        title: 'Next month',
        ariaLabel: 'Next month',
        onClick: () => {
          viewMonth = shiftMonthKey(viewMonth as string, 1);
          render();
        },
      }),
    );

    const leadingBlanks = firstWeekday(viewMonth);
    const totalDays = daysInMonth(viewMonth);
    const cells: HTMLElement[] = [];
    for (let i = 0; i < leadingBlanks; i += 1) {
      cells.push(h('div', { class: 'calendar__cell calendar__cell--blank' }));
    }
    for (let day = 1; day <= totalDays; day += 1) {
      const dateStr = `${viewMonth}-${String(day).padStart(2, '0')}`;
      const real = byDate.get(dateStr);
      if (!real) {
        cells.push(
          h(
            'div',
            {
              class: 'calendar__cell calendar__cell--empty',
              title: 'No real rainfall data for this date',
            },
            h('span', { class: 'calendar__day-number' }, String(day)),
          ),
        );
        continue;
      }
      const glyphWrap = h('span', { class: 'calendar__glyph' });
      glyphWrap.appendChild(precipitationGlyph({ totalMm: real.totalMm, maxTotalMm }));
      cells.push(
        h(
          'button',
          {
            type: 'button',
            class: `calendar__cell calendar__cell--real${dateStr === selectedDate ? ' calendar__cell--selected' : ''}`,
            title: `${real.totalMm.toFixed(1)} mm on ${dateStr}`,
            onClick: () => selectRainfallDate(dateStr),
          },
          glyphWrap,
          h('span', { class: 'calendar__day-number' }, String(day)),
        ),
      );
    }

    const grid = h(
      'div',
      { class: 'calendar' },
      header,
      h(
        'div',
        { class: 'calendar__weekdays' },
        ...WEEKDAY_LABELS.map((label) => h('span', {}, label)),
      ),
      h('div', { class: 'calendar__grid' }, ...cells),
    );

    const selectedDay = selectedDate ? byDate.get(selectedDate) : undefined;
    const busy = preparing || isRunActive(floodRun.activeRun?.status);
    const profileEntries = computeMonthlyProfile(days, viewMonth, selectedDate);

    const detail = selectedDay
      ? h(
          'div',
          { class: 'rainfall-detail' },
          h(
            'h3',
            { class: 'rainfall-detail__title' },
            DAY_FORMATTER.format(new Date(`${selectedDay.date}T00:00:00Z`)),
          ),
          h(
            'div',
            { class: 'rainfall-detail__readouts' },
            h(
              'div',
              { class: 'rainfall-detail__readout' },
              h(
                'span',
                { class: 'rainfall-detail__readout-value' },
                selectedDay.totalMm.toFixed(1),
              ),
              h('span', { class: 'rainfall-detail__readout-unit' }, 'mm total'),
            ),
            h(
              'div',
              { class: 'rainfall-detail__readout' },
              h(
                'span',
                { class: 'rainfall-detail__readout-value' },
                selectedDay.maxHourlyMm.toFixed(1),
              ),
              h('span', { class: 'rainfall-detail__readout-unit' }, 'mm/hr peak'),
            ),
          ),
          monthlyProfileChart(profileEntries),
          provenance
            ? h('p', { class: 'rainfall-detail__provenance' }, provenance.sourceDisplayName)
            : null,
          button({
            label: busy ? 'Running simulation…' : 'Run simulation for this day',
            variant: 'primary',
            disabled: busy,
            onClick: () => void runSelectedRainfallEvent(),
          }),
          floodRun.activeRun && !isRunActive(floodRun.activeRun.status)
            ? h('div', { class: 'rainfall-detail__status' }, statusPill(floodRun.activeRun.status))
            : null,
          error ? h('p', { role: 'alert' }, error.message) : null,
        )
      : h(
          'p',
          { class: 'rainfall-detail__hint' },
          'Select a highlighted date to inspect and run it.',
        );

    clear(shell.body);
    mount(shell.body, grid, detail);
  };

  if (rainfallEventsStore.get().status === 'idle') {
    void loadRainfallEvents();
  }
  render();
  const unsubscribeRainfall = rainfallEventsStore.subscribe(render);
  const unsubscribeFloodRun = floodRunStore.subscribe(render);
  return {
    destroy: (): void => {
      unsubscribeRainfall();
      unsubscribeFloodRun();
      container.removeChild(shell.element);
    },
  };
}
