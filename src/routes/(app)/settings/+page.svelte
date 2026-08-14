<script lang="ts">
  import {
    Bell,
    Bot,
    Database,
    HardDrive,
    LockKeyhole,
    Palette,
    Pencil,
    Plus,
    Save,
    ScanText,
    Server,
    Trash2,
    Users
  } from '@lucide/svelte';
  import Modal from '$lib/components/Modal.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import Toast from '$lib/components/Toast.svelte';
  import ThemePicker from '$lib/components/ThemePicker.svelte';
  import { normalizeGradingPreferences } from '$lib/domain/grading';
  import { humanize } from '$lib/domain/labels';

  let { data, form } = $props();
  const reminderPreferences = $derived(data.account.reminderPreferences as Record<string, boolean>);
  const grading = $derived(normalizeGradingPreferences(data.account.gradingPreferences));
  const bytes = (value: number) =>
    value >= 1024 ** 3
      ? `${(value / 1024 ** 3).toFixed(2)} GB`
      : `${(value / 1024 ** 2).toFixed(1)} MB`;
  const usagePercent = $derived(
    Math.min(
      100,
      Math.round((data.account.storageUsedBytes / data.account.storageQuotaBytes) * 100)
    )
  );
  let providerOpen = $state(false);
  let selectedProvider = $state<(typeof data.ocrProviders)[number] | null>(null);

  function openProvider(provider: (typeof data.ocrProviders)[number] | null = null) {
    selectedProvider = provider;
    providerOpen = true;
  }
</script>

<svelte:head>
  <title>Settings · StudySky</title>
</svelte:head>

<div class="page settings-page">
  <PageHeader
    eyebrow="Workspace"
    title="Settings"
    description="Study preferences, private storage, optional local AI, and account administration."
    backHref="/today"
    backLabel="Today"
  />

  <Toast
    message={form?.error
      ? form.error
      : form?.success
        ? form.action === 'testAI'
          ? form.testMessage
          : 'Settings saved.'
        : ''}
    tone={form?.error ? 'error' : 'success'}
    token={form}
  />

  <nav class="settings-nav" aria-label="Settings sections">
    <a href="#appearance">Appearance</a>
    <a href="#profile">Profile</a>
    <a href="#security">Security</a>
    <a href="#study">Study</a>
    <a href="#notifications">Notifications</a>
    <a href="#storage">Storage</a>
    {#if data.account.role === 'admin'}<a href="#ai">AI</a>{/if}
    {#if data.account.role === 'admin'}<a href="#ocr-models">OCR models</a>{/if}
    <a href="#grading">Grading</a>
    {#if data.account.role === 'admin'}<a href="#members">Members</a>{/if}
  </nav>

  <section id="appearance" class="settings-section appearance-section">
    <div class="section-label">
      <Palette size={18} />
      <div>
        <h2>Appearance</h2>
        <p>Choose the interface accent that feels best to you.</p>
      </div>
    </div>
    <div class="surface panel">
      <ThemePicker />
      <p class="subtle appearance-note">
        Saved on this device. Light and dark mode remain available in the sidebar.
      </p>
    </div>
  </section>

  <form method="POST" action="?/profile" class="settings-stack">
    <section id="profile" class="settings-section">
      <div class="section-label">
        <LockKeyhole size={18} />
        <div>
          <h2>Profile</h2>
          <p>Your sign-in identity and local time.</p>
        </div>
      </div>
      <div class="surface panel form-grid">
        <div class="field">
          <label for="settings-name">Name</label>
          <input id="settings-name" name="name" value={data.account.name} required />
        </div>
        <div class="field">
          <label for="settings-email">Email</label>
          <input id="settings-email" value={data.account.email} disabled />
        </div>
        <div class="field form-span">
          <label for="settings-timezone">Timezone</label>
          <input id="settings-timezone" name="timezone" value={data.account.timezone} required />
          <span class="subtle"
            >Use an IANA timezone such as UTC, Europe/Paris, or Asia/Kathmandu.</span
          >
        </div>
      </div>
    </section>

    <section id="study" class="settings-section">
      <div class="section-label">
        <Database size={18} />
        <div>
          <h2>Study planning</h2>
          <p>Limits used by the deterministic weekly planner.</p>
        </div>
      </div>
      <div class="surface panel form-grid">
        <div class="field">
          <label for="sleep-start">Sleep starts</label>
          <input
            id="sleep-start"
            name="sleepStart"
            type="time"
            value={data.account.sleepStart.slice(0, 5)}
            required
          />
        </div>
        <div class="field">
          <label for="sleep-end">Sleep ends</label>
          <input
            id="sleep-end"
            name="sleepEnd"
            type="time"
            value={data.account.sleepEnd.slice(0, 5)}
            required
          />
        </div>
        <div class="field">
          <label for="travel-minutes">Normal university travel (minutes)</label>
          <input
            id="travel-minutes"
            name="travelMinutes"
            type="number"
            min="0"
            max="360"
            value={data.account.travelMinutes}
          />
        </div>
        <div class="field">
          <label for="preparation-minutes">Class preparation buffer</label>
          <input
            id="preparation-minutes"
            name="preparationMinutes"
            type="number"
            min="0"
            max="180"
            value={data.account.preparationMinutes}
          />
        </div>
        <div class="field">
          <label for="session-minutes">Preferred focus session</label>
          <input
            id="session-minutes"
            name="preferredSessionMinutes"
            type="number"
            min="10"
            max="240"
            value={data.account.preferredSessionMinutes}
          />
        </div>
        <div class="field">
          <label for="rest-day">Preferred rest day</label>
          <select id="rest-day" name="preferredRestDay">
            {#each ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as day, index}
              <option value={index} selected={index === data.account.preferredRestDay}>{day}</option
              >
            {/each}
          </select>
        </div>
        <div class="field">
          <label for="weekday-limit">Weekday study limit (minutes)</label>
          <input
            id="weekday-limit"
            name="maxWeekdayStudyMinutes"
            type="number"
            min="0"
            max="1440"
            value={data.account.maxWeekdayStudyMinutes}
          />
        </div>
        <div class="field">
          <label for="weekend-limit">Weekend study limit (minutes)</label>
          <input
            id="weekend-limit"
            name="maxWeekendStudyMinutes"
            type="number"
            min="0"
            max="1440"
            value={data.account.maxWeekendStudyMinutes}
          />
        </div>
        <label class="check-row form-span">
          <input type="checkbox" name="eveningStudy" checked={data.account.eveningStudy} />
          <span
            ><strong>Evening study is acceptable</strong><small
              >The planner may use reasonable evening time outside sleep.</small
            ></span
          >
        </label>
        <label class="check-row form-span">
          <input
            type="checkbox"
            name="automaticReschedule"
            checked={data.account.automaticReschedule}
          />
          <span
            ><strong>Automatically propose missed-work changes</strong><small
              >Deadlines are never moved silently.</small
            ></span
          >
        </label>
      </div>
    </section>

    <section id="notifications" class="settings-section">
      <div class="section-label">
        <Bell size={18} />
        <div>
          <h2>Notifications</h2>
          <p>Choose a restrained set of useful reminders.</p>
        </div>
      </div>
      <div class="surface notification-grid">
        {#each ['class_upcoming', 'study_session', 'assignment_deadline', 'revision_due', 'task_overdue', 'scan_unprocessed', 'weekly_planning'] as kind}
          <label class="check-row">
            <input
              type="checkbox"
              name={`reminder_${kind}`}
              checked={reminderPreferences[kind] ??
                ['assignment_deadline', 'revision_due', 'weekly_planning'].includes(kind)}
            />
            <span><strong>{humanize(kind)}</strong></span>
          </label>
        {/each}
      </div>
    </section>

    <div class="sticky-save">
      <button class="button button-primary" type="submit"
        ><Save size={15} /> Save profile and study settings</button
      >
    </div>
  </form>

  <section id="security" class="settings-section">
    <div class="section-label">
      <LockKeyhole size={18} />
      <div>
        <h2>Password</h2>
        <p>Changing it signs out every other active session.</p>
      </div>
    </div>
    <form method="POST" action="?/password" class="surface panel form-grid">
      <div class="field form-span">
        <label for="current-password">Current password</label>
        <input
          id="current-password"
          name="currentPassword"
          type="password"
          autocomplete="current-password"
          required
        />
      </div>
      <div class="field">
        <label for="new-password">New password</label>
        <input
          id="new-password"
          name="newPassword"
          type="password"
          autocomplete="new-password"
          minlength="12"
          required
        />
      </div>
      <div class="field">
        <label for="confirm-password">Confirm new password</label>
        <input
          id="confirm-password"
          name="confirmPassword"
          type="password"
          autocomplete="new-password"
          minlength="12"
          required
        />
      </div>
      <div class="form-actions form-span">
        <button class="button button-primary" type="submit">Change password</button>
      </div>
    </form>
  </section>

  <section id="storage" class="settings-section">
    <div class="section-label">
      <HardDrive size={18} />
      <div>
        <h2>Private storage</h2>
        <p>Originals and all derived copies count toward quota.</p>
      </div>
    </div>
    <div class="surface panel storage-panel">
      <div class="row-between">
        <span><strong>{bytes(data.account.storageUsedBytes)}</strong> used</span>
        <span
          >{bytes(data.account.storageQuotaBytes - data.account.storageUsedBytes)} available</span
        >
      </div>
      <div class="progress-track">
        <div class="progress-value" style={`width: ${usagePercent}%`}></div>
      </div>
      <p class="subtle">
        {usagePercent}% of {bytes(data.account.storageQuotaBytes)} · files are stored outside the public
        web directory.
      </p>
    </div>
  </section>

  {#if data.account.role === 'admin'}
    <section id="ai" class="settings-section">
      <div class="section-label">
        <Bot size={18} />
        <div>
          <h2>Optional AI provider</h2>
          <p>Core StudySky features do not depend on AI.</p>
        </div>
      </div>
      <div class="surface panel">
        <form method="POST" action="?/ai">
          <div class="form-grid">
            <div class="field">
              <label for="ai-provider">Provider</label>
              <select id="ai-provider" name="provider">
                <option value="none" selected={data.ai.provider === 'none'}>No AI</option>
                <option
                  value="openai_compatible"
                  selected={data.ai.provider === 'openai_compatible'}
                  >Local OpenAI-compatible endpoint</option
                >
              </select>
            </div>
            <div class="field">
              <label for="ai-base-url">Provider URL</label>
              <input
                id="ai-base-url"
                name="baseUrl"
                type="url"
                value={data.ai.baseUrl ?? ''}
                placeholder="http://ollama:11434/"
              />
            </div>
            <div class="field">
              <label for="ai-model">Model name</label>
              <input
                id="ai-model"
                name="model"
                value={data.ai.model ?? ''}
                placeholder="qwen3.5:0.8b"
              />
            </div>
            <div class="field">
              <label for="ai-key">API key</label>
              <input
                id="ai-key"
                name="apiKey"
                type="password"
                autocomplete="new-password"
                placeholder={data.ai.hasApiKey
                  ? 'Saved securely · enter to replace'
                  : 'Optional for local endpoints'}
              />
              {#if !data.encryptionConfigured}
                <span class="subtle">Set SETTINGS_ENCRYPTION_KEY before saving a credential.</span>
              {/if}
            </div>
            <div class="field">
              <label for="context-limit">Context limit</label>
              <input
                id="context-limit"
                name="contextLimit"
                type="number"
                min="512"
                value={data.ai.contextLimit}
              />
            </div>
            <div class="field">
              <label for="ai-timeout">Timeout (milliseconds)</label>
              <input
                id="ai-timeout"
                name="timeoutMs"
                type="number"
                min="1000"
                value={data.ai.timeoutMs}
              />
            </div>
            <div class="field">
              <label for="max-tokens">Maximum generated tokens</label>
              <input
                id="max-tokens"
                name="maxGeneratedTokens"
                type="number"
                min="32"
                value={data.ai.maxGeneratedTokens}
              />
            </div>
            <div class="field">
              <label for="embedding-provider">Embedding provider/model</label>
              <input
                id="embedding-provider"
                name="embeddingProvider"
                value={data.ai.embeddingProvider ?? ''}
              />
            </div>
            <label class="check-row form-span">
              <input
                type="checkbox"
                name="documentAnalysisEnabled"
                checked={data.ai.documentAnalysisEnabled}
              />
              <span
                ><strong>Enable document analysis</strong><small
                  >Only authorised documents can be used. Remote providers require an explicit
                  privacy decision.</small
                ></span
              >
            </label>
            {#if data.ai.hasApiKey}
              <label class="check-row form-span">
                <input type="checkbox" name="removeApiKey" />
                <span><strong>Remove saved API key</strong></span>
              </label>
            {/if}
          </div>
          <div class="form-actions">
            <button class="button button-primary" type="submit"
              ><Save size={15} /> Save AI settings</button
            >
          </div>
        </form>
        <form method="POST" action="?/testAI" class="test-row">
          <button class="button" type="submit">Test saved connection</button>
          {#if form?.action === 'testAI' && form?.testMessage}
            <span class="subtle">{form.testMessage}</span>
          {/if}
        </form>
      </div>
    </section>
  {/if}

  {#if data.account.role === 'admin'}
    <section id="ocr-models" class="settings-section">
      <div class="section-label row-between">
        <div class="section-title">
          <ScanText size={18} />
          <div>
            <h2>OCR models</h2>
            <p>Approve self-hosted models that students may use for their notes.</p>
          </div>
        </div>
        <button class="button" type="button" onclick={() => openProvider()}>
          <Plus size={15} /> Add model
        </button>
      </div>
      <div class="surface provider-panel">
        <div class="provider-row built-in-row">
          <span class="provider-icon"><ScanText size={16} /></span>
          <div class="provider-copy">
            <strong>StudySky browser OCR</strong>
            <small>PP-OCRv5 English and Latin · always local to each student’s browser</small>
          </div>
          <span class="status-pill enabled">Built in</span>
        </div>
        <div class="provider-row built-in-row">
          <span class="provider-icon"><Server size={16} /></span>
          <div class="provider-copy">
            <strong>StudySky formula service</strong>
            <small>Optional PP-FormulaNet service managed through the server environment</small>
          </div>
          <span class="status-pill">Compose</span>
        </div>
        {#each data.ocrProviders as provider}
          <div class="provider-row">
            <span class="provider-icon"><Server size={16} /></span>
            <div class="provider-copy">
              <strong>{provider.name}</strong>
              <small>
                {provider.capabilities
                  .map((capability) =>
                    capability === 'formula_latex' ? 'Formula to LaTeX' : 'Text'
                  )
                  .join(' · ')}
                {provider.languages.length ? ` · ${provider.languages.join(', ')}` : ''}
              </small>
            </div>
            <span class:enabled={provider.enabled} class="status-pill">
              {provider.enabled ? 'Available' : 'Disabled'}
            </span>
            <form method="POST" action="?/testOcrProvider">
              <input type="hidden" name="id" value={provider.id} />
              <button class="button button-small" type="submit">Test</button>
            </form>
            <button
              class="button button-icon button-quiet"
              type="button"
              aria-label={`Edit ${provider.name}`}
              title={`Edit ${provider.name}`}
              onclick={() => openProvider(provider)}
            >
              <Pencil size={15} />
            </button>
          </div>
        {/each}
        {#if data.ocrProviders.length === 0}
          <div class="provider-empty">
            <p>No extra models connected.</p>
            <span class="subtle">Built-in browser OCR continues to work without one.</span>
          </div>
        {/if}
      </div>
      {#if form?.action === 'testOcrProvider' && form?.testMessage}
        <p class="subtle provider-test" role="status">{form.testMessage}</p>
      {/if}
    </section>
  {/if}

  <section id="grading" class="settings-section">
    <div class="section-label">
      <Database size={18} />
      <div>
        <h2>Grading and CPA</h2>
        <p>Estimate a credit-weighted result from recorded assessments.</p>
      </div>
    </div>
    <form method="POST" action="?/grading" class="surface panel">
      <label class="check-row">
        <input type="checkbox" name="enabled" checked={grading.enabled ?? false} />
        <span
          ><strong>Enable configured CPA tracking</strong><small
            >StudySky labels every result as an estimate, not an official transcript.</small
          ></span
        >
      </label>
      <div class="form-grid grading-fields">
        <div class="field">
          <label for="grading-preset">Grading method</label>
          <select id="grading-preset" name="preset">
            <option
              value="custom_weighted_percentage"
              selected={grading.preset === 'custom_weighted_percentage'}
              >Generic credit-weighted percentage</option
            >
            <option value="uom_2026_27" selected={grading.preset === 'uom_2026_27'}
              >University of Mauritius · 2026/27 preset</option
            >
          </select>
        </div>
        <div class="field">
          <label for="pass-mark">Programme pass mark</label>
          <select id="pass-mark" name="passMark">
            <option value="40" selected={grading.passMark === 40}>40%</option>
            <option value="50" selected={grading.passMark === 50}>50%</option>
          </select>
          <span class="subtle">Check the pass mark in your programme regulations.</span>
        </div>
        <div class="field form-span">
          <label for="formula-notes">Programme-specific notes</label>
          <textarea
            id="formula-notes"
            name="formulaNotes"
            placeholder="Record any exclusions or special weighting here."
            >{grading.formulaNotes}</textarea
          >
          <span class="subtle">
            The generic method weights module percentages by credit units. The optional UoM preset
            also applies each module's academic weighting and published classification bands.
          </span>
        </div>
      </div>
      <div class="form-actions">
        <button class="button button-primary" type="submit">Save grading rules</button>
      </div>
    </form>
  </section>

  {#if data.account.role === 'admin'}
    <section id="members" class="settings-section">
      <div class="section-label">
        <Users size={18} />
        <div>
          <h2>Members</h2>
          <p>Registration is disabled; administrators create separate private accounts.</p>
        </div>
      </div>
      <div class="surface members-panel">
        {#each data.members as member}
          <article class="member-row">
            <span class="avatar">{member.name.slice(0, 1).toUpperCase()}</span>
            <span class="member-copy"
              ><strong>{member.name}</strong><small>{member.email} · {member.role}</small></span
            >
            <form method="POST" action="?/quota" class="quota-form">
              <input type="hidden" name="userId" value={member.id} />
              <label class="sr-only" for={`quota-${member.id}`}>Quota for {member.name} in GB</label
              >
              <input
                id={`quota-${member.id}`}
                name="quotaGb"
                type="number"
                min="0.25"
                step="0.25"
                value={(member.quota / 1024 ** 3).toFixed(2)}
              />
              <button class="button button-sm" type="submit">Update quota</button>
            </form>
          </article>
        {/each}
        <details class="new-member">
          <summary><Plus size={15} /> Create member account</summary>
          <form method="POST" action="?/createMember" class="panel form-grid">
            <div class="field">
              <label for="member-name">Name</label><input id="member-name" name="name" required />
            </div>
            <div class="field">
              <label for="member-email">Email</label><input
                id="member-email"
                name="email"
                type="email"
                required
              />
            </div>
            <div class="field">
              <label for="member-password">Temporary password</label><input
                id="member-password"
                name="password"
                type="password"
                minlength="12"
                required
              />
            </div>
            <div class="field">
              <label for="member-quota">Quota (GB)</label><input
                id="member-quota"
                name="quotaGb"
                type="number"
                min="0.25"
                step="0.25"
                value="10"
                required
              />
            </div>
            <div class="form-actions form-span">
              <button class="button button-primary" type="submit">Create private account</button>
            </div>
          </form>
        </details>
      </div>
    </section>
  {/if}
</div>

{#if data.account.role === 'admin'}
  <Modal
    bind:open={providerOpen}
    title={selectedProvider ? 'Edit OCR model' : 'Add OCR model'}
    description="Connect a service that follows the StudySky OCR Provider API."
    size="medium"
  >
    <form method="POST" action="?/saveOcrProvider" class="provider-form">
      {#if selectedProvider}<input type="hidden" name="id" value={selectedProvider.id} />{/if}
      <div class="form-grid">
        <div class="field">
          <label for="ocr-provider-name">Name</label>
          <input
            id="ocr-provider-name"
            name="name"
            value={selectedProvider?.name ?? ''}
            placeholder="My handwriting model"
            required
          />
        </div>
        <div class="field">
          <label for="ocr-provider-url">Service URL</label>
          <input
            id="ocr-provider-url"
            name="baseUrl"
            type="url"
            value={selectedProvider?.baseUrl ?? ''}
            placeholder="http://ocr-model:8080"
            required
          />
        </div>
        <fieldset class="field form-span capability-fieldset">
          <legend>What may this model read?</legend>
          <div>
            <label>
              <input
                type="checkbox"
                name="capability_text"
                checked={!selectedProvider || selectedProvider.capabilities.includes('text')}
              />
              Text and handwriting
            </label>
            <label>
              <input
                type="checkbox"
                name="capability_formula_latex"
                checked={selectedProvider?.capabilities.includes('formula_latex') ?? false}
              />
              Formula to LaTeX
            </label>
          </div>
        </fieldset>
        <div class="field form-span">
          <label for="ocr-provider-languages">Languages</label>
          <input
            id="ocr-provider-languages"
            name="languages"
            value={selectedProvider?.languages.join(', ') ?? 'English'}
            placeholder="English, French"
          />
          <span class="subtle">Comma-separated. Leave empty for formula-only models.</span>
        </div>
        <div class="field form-span">
          <label for="ocr-provider-token">Bearer token</label>
          <input
            id="ocr-provider-token"
            name="token"
            type="password"
            autocomplete="new-password"
            placeholder={selectedProvider?.hasToken
              ? 'Saved securely · enter to replace'
              : 'Optional'}
          />
        </div>
        <div class="field">
          <label for="ocr-provider-timeout">Timeout (ms)</label>
          <input
            id="ocr-provider-timeout"
            name="timeoutMs"
            type="number"
            min="5000"
            max="180000"
            value={selectedProvider?.timeoutMs ?? 90000}
            required
          />
        </div>
        <div class="field">
          <label for="ocr-provider-size">Maximum image (MB)</label>
          <input
            id="ocr-provider-size"
            name="maxImageMb"
            type="number"
            min="1"
            max="12"
            value={selectedProvider?.maxImageMb ?? 6}
            required
          />
        </div>
        <input type="hidden" name="maxPixels" value={selectedProvider?.maxPixels ?? 16000000} />
        <label class="check-row form-span">
          <input type="checkbox" name="enabled" checked={selectedProvider?.enabled ?? false} />
          <span>
            <strong>Make available to students</strong>
            <small>Test the saved connection before enabling it.</small>
          </span>
        </label>
        {#if selectedProvider?.hasToken}
          <label class="check-row form-span">
            <input type="checkbox" name="removeToken" />
            <span><strong>Remove saved token</strong></span>
          </label>
        {/if}
      </div>
      <div class="form-actions provider-form-actions">
        {#if selectedProvider}
          <button
            class="button danger-button"
            type="submit"
            formaction="?/deleteOcrProvider"
            onclick={(event) => {
              if (!window.confirm(`Remove ${selectedProvider?.name}?`)) event.preventDefault();
            }}
          >
            <Trash2 size={15} /> Remove
          </button>
        {/if}
        <span></span>
        <button class="button" type="button" onclick={() => (providerOpen = false)}>Cancel</button>
        <button class="button button-primary" type="submit">
          <Save size={15} /> Save model
        </button>
      </div>
    </form>
  </Modal>
{/if}

<style>
  .settings-nav {
    position: sticky;
    z-index: 5;
    top: 78px;
    display: flex;
    overflow-x: auto;
    gap: 4px;
    margin-bottom: 30px;
    padding: 6px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: color-mix(in srgb, var(--surface) 95%, transparent);
    backdrop-filter: blur(10px);
  }

  .settings-nav a {
    min-width: max-content;
    padding: 6px 9px;
    border-radius: 5px;
    color: var(--text-soft);
    font-size: 12px;
  }

  .settings-nav a:hover {
    color: var(--text);
    background: var(--surface-hover);
  }

  .settings-stack,
  .settings-section {
    display: grid;
    gap: 12px;
  }

  .settings-stack {
    gap: 34px;
  }

  .settings-section {
    scroll-margin-top: 144px;
    margin-top: 34px;
  }

  .appearance-section {
    margin-top: 0;
    margin-bottom: 34px;
  }

  .appearance-note {
    margin: 12px 0 0;
  }

  .settings-stack .settings-section {
    margin-top: 0;
  }

  .section-label {
    display: flex;
    align-items: flex-start;
    gap: 10px;
  }

  .section-title {
    display: flex;
    align-items: flex-start;
    gap: 10px;
  }

  .provider-panel {
    overflow: hidden;
  }

  .provider-row {
    display: flex;
    min-height: 62px;
    align-items: center;
    gap: 9px;
    padding: 10px 12px;
    border-bottom: 1px solid var(--border);
  }

  .provider-row:last-child {
    border-bottom: 0;
  }

  .built-in-row {
    background: color-mix(in srgb, var(--surface-muted) 55%, transparent);
  }

  .provider-icon {
    display: grid;
    width: 30px;
    height: 30px;
    flex: 0 0 auto;
    place-items: center;
    border-radius: 6px;
    background: var(--surface-hover);
  }

  .provider-copy {
    display: grid;
    min-width: 0;
    flex: 1;
  }

  .provider-copy small {
    overflow: hidden;
    color: var(--text-soft);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .status-pill {
    padding: 3px 7px;
    border: 1px solid var(--border);
    border-radius: 999px;
    color: var(--text-soft);
    font-size: 11px;
    white-space: nowrap;
  }

  .status-pill.enabled {
    border-color: color-mix(in srgb, #27844b 30%, var(--border));
    color: #27844b;
    background: color-mix(in srgb, #27844b 8%, transparent);
  }

  .provider-empty {
    padding: 18px 12px;
    text-align: center;
  }

  .provider-empty p,
  .provider-test {
    margin: 0;
  }

  .provider-test {
    padding-left: 2px;
  }

  .provider-form {
    display: grid;
    gap: 18px;
  }

  .capability-fieldset {
    padding: 0;
    border: 0;
  }

  .capability-fieldset > div {
    display: flex;
    flex-wrap: wrap;
    gap: 14px;
    padding-top: 7px;
  }

  .capability-fieldset label {
    display: flex;
    align-items: center;
    gap: 7px;
  }

  .provider-form-actions {
    display: grid;
    grid-template-columns: auto 1fr auto auto;
  }

  .danger-button {
    color: var(--danger, #b42318);
  }

  .section-label h2,
  .section-label p {
    margin-bottom: 2px;
  }

  .section-label p {
    color: var(--text-soft);
    font-size: 12px;
  }

  .check-row {
    display: flex;
    min-height: 46px;
    align-items: flex-start;
    gap: 10px;
    padding: 10px;
    border-radius: 6px;
    cursor: pointer;
  }

  .check-row:hover {
    background: var(--surface-hover);
  }

  .check-row input {
    width: 17px;
    height: 17px;
    margin-top: 2px;
  }

  .check-row span {
    display: grid;
  }

  .check-row small {
    color: var(--text-soft);
  }

  .notification-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    padding: 8px;
  }

  .sticky-save {
    display: flex;
    justify-content: flex-end;
  }

  .storage-panel {
    display: grid;
    gap: 9px;
  }

  .storage-panel p {
    margin-bottom: 0;
  }

  .test-row {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-top: 16px;
    padding-top: 16px;
    border-top: 1px solid var(--border);
  }

  .grading-fields {
    margin-top: 14px;
  }

  .members-panel {
    overflow: hidden;
  }

  .member-row {
    display: flex;
    min-height: 68px;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
    border-bottom: 1px solid var(--border);
  }

  .avatar {
    display: grid;
    width: 32px;
    height: 32px;
    flex: 0 0 auto;
    place-items: center;
    border-radius: 6px;
    background: var(--surface-hover);
    font-size: 12px;
    font-weight: 700;
  }

  .member-copy {
    display: grid;
    min-width: 0;
    flex: 1;
  }

  .member-copy small {
    color: var(--text-soft);
  }

  .quota-form {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .quota-form input {
    width: 90px;
    min-height: 34px;
  }

  .new-member summary {
    display: flex;
    min-height: 48px;
    align-items: center;
    gap: 8px;
    padding: 10px 14px;
    font-weight: 600;
    list-style: none;
  }

  .new-member[open] summary {
    border-bottom: 1px solid var(--border);
  }

  @media (max-width: 620px) {
    .settings-nav {
      top: 0;
    }

    .notification-grid {
      grid-template-columns: 1fr;
    }

    .member-row {
      align-items: flex-start;
      flex-wrap: wrap;
    }

    .member-copy {
      width: calc(100% - 44px);
    }

    .quota-form {
      width: 100%;
      padding-left: 42px;
    }

    .quota-form input {
      flex: 1;
    }

    .provider-row {
      align-items: flex-start;
      flex-wrap: wrap;
    }

    .provider-copy {
      width: calc(100% - 42px);
    }

    .provider-form-actions {
      grid-template-columns: 1fr 1fr;
    }

    .provider-form-actions span {
      display: none;
    }
  }
</style>
