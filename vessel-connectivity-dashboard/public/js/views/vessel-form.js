import { api, ApiError } from '../api.js';
import { modal, toast } from '../ui/components.js';
import { h } from '../ui/dom.js';

/**
 * Add / edit form for the vessel master. Validation happens on the server
 * (single source of truth); field errors it returns are shown under the
 * matching input.
 */
export function openVesselForm({ meta, vessel, onSaved }) {
  const editing = Boolean(vessel);
  const initial = {
    name: vessel?.name ?? '',
    imoNumber: vessel?.imoNumber ?? '',
    callSign: vessel?.callSign ?? '',
    vesselType: vessel?.vesselType ?? '',
    flag: vessel?.flag ?? '',
    providerId: vessel ? String(vessel.provider.id) : '',
    technology: vessel?.technology ?? '',
  };

  const inputs = {};
  const errorSlots = {};

  function field(key, label, control, { full = false, hint } = {}) {
    inputs[key] = control;
    errorSlots[key] = h('div', { class: 'field-error', id: `err-${key}`, hidden: true });
    control.id = `vf-${key}`;
    control.setAttribute('aria-describedby', `err-${key}`);
    return h(
      'div',
      { class: `form-field${full ? ' full' : ''}` },
      h('label', { for: `vf-${key}` }, label),
      control,
      hint && h('div', { class: 'form-hint' }, hint),
      errorSlots[key],
    );
  }

  const text = (key, extra = {}) => h('input', { class: 'input', type: 'text', value: initial[key], autocomplete: 'off', ...extra });
  const choose = (key, placeholder, options) =>
    h(
      'select',
      { class: 'select' },
      h('option', { value: '' }, placeholder),
      options.map(([value, label]) => h('option', { value, selected: initial[key] === value }, label)),
    );

  const formError = h('div', { class: 'form-error', role: 'alert', hidden: true });
  const saveBtn = h('button', { class: 'btn btn-primary', type: 'submit' }, editing ? 'Save changes' : 'Add vessel');

  function showErrors(fields = {}) {
    for (const key of Object.keys(inputs)) {
      const message = fields[key];
      errorSlots[key].textContent = message ?? '';
      errorSlots[key].hidden = !message;
      inputs[key].setAttribute('aria-invalid', message ? 'true' : 'false');
    }
    const first = Object.keys(fields).find((k) => inputs[k]);
    if (first) inputs[first].focus();
  }

  const form = h(
    'form',
    {
      novalidate: true,
      async onSubmit(event) {
        event.preventDefault();
        formError.hidden = true;
        saveBtn.disabled = true;

        const body = Object.fromEntries(Object.entries(inputs).map(([key, el]) => [key, el.value.trim()]));
        body.providerId = body.providerId ? Number(body.providerId) : null;

        try {
          const saved = editing ? await api.put(`/api/vessels/${vessel.id}`, body) : await api.post('/api/vessels', body);
          dialog.close();
          toast(editing ? `Saved ${saved.name}` : `Added ${saved.name}`);
          onSaved?.(saved);
        } catch (err) {
          if (err instanceof ApiError && err.fields) {
            showErrors(err.fields);
          } else {
            formError.textContent = err.message;
            formError.hidden = false;
          }
        } finally {
          saveBtn.disabled = false;
        }
      },
    },
    h(
      'div',
      { class: 'form-grid' },
      field('name', 'Vessel name', text('name', { maxlength: 80 }), { full: true }),
      field('imoNumber', 'IMO number', text('imoNumber', { inputmode: 'numeric', maxlength: 11 }), { hint: '7 digits, for example 9074729' }),
      field('callSign', 'Call sign (optional)', text('callSign', { maxlength: 8 })),
      field('vesselType', 'Vessel type', choose('vesselType', 'Choose a type', meta.vesselTypes.map((t) => [t, t]))),
      field('flag', 'Flag state', text('flag', { maxlength: 40 })),
      field('providerId', 'Connectivity provider', choose('providerId', 'Choose a provider', meta.providers.map((p) => [String(p.id), p.name]))),
      field('technology', 'Technology', choose('technology', 'Choose a technology', meta.technologies.map((t) => [t.key, t.label]))),
    ),
    formError,
    h(
      'div',
      { class: 'form-actions' },
      h('button', { class: 'btn', type: 'button', onClick: () => dialog.close() }, 'Cancel'),
      saveBtn,
    ),
  );

  const dialog = modal({ title: editing ? `Edit ${vessel.name}` : 'Add vessel', content: form });
  inputs.name.focus();
}

export async function deleteVessel(vessel) {
  await api.del(`/api/vessels/${vessel.id}`);
}
