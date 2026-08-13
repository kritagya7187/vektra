import { ApiError, getDataProvenanceRecord, getDataSource } from '../api';
import { formatNullableText, formatTimestamp } from '../utils/formatting';
import { clear, h, mount } from '../utils/dom';
export function renderProvenanceInspector(container: HTMLElement, provenanceId: string): void {
  mount(container, h('p', { class: 'provenance__loading', role: 'status' }, 'Loading provenance…'));
  void loadAndRender(container, provenanceId);
}
async function loadAndRender(container: HTMLElement, provenanceId: string): Promise<void> {
  try {
    const record = await getDataProvenanceRecord(provenanceId);
    const source = await getDataSource(record.sourceCode).catch(() => null);
    clear(container);
    mount(
      container,
      h(
        'dl',
        { class: 'provenance__detail' },
        h('dt', {}, 'Source'),
        h('dd', {}, source ? source.displayName : record.sourceCode),
        h('dt', {}, 'Source product identifier'),
        h('dd', {}, formatNullableText(record.sourceProductIdentifier)),
        h('dt', {}, 'Retrieved'),
        h('dd', {}, formatTimestamp(record.retrievalTimestamp)),
        h('dt', {}, 'License'),
        h('dd', {}, formatNullableText(record.license)),
        h('dt', {}, 'Ingestion pipeline version'),
        h('dd', {}, formatNullableText(record.ingestionPipelineVersion)),
        h('dt', {}, 'Checksum'),
        h('dd', {}, formatNullableText(record.checksum)),
      ),
    );
  } catch (err) {
    const message = err instanceof ApiError ? err.message : 'Failed to load provenance.';
    clear(container);
    mount(container, h('p', { class: 'provenance__error', role: 'alert' }, message));
  }
}
