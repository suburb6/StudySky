<script lang="ts">
  import OfflineUploadQueue from '$lib/components/OfflineUploadQueue.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import Toast from '$lib/components/Toast.svelte';
  import UploadForm from '$lib/components/UploadForm.svelte';

  let { data } = $props();
</script>

<svelte:head>
  <title>Add material · StudySky</title>
</svelte:head>

<div class="page">
  <PageHeader
    title="Add material"
    description="Capture pages or choose a file, then connect it to a module and chapter."
    backHref={data.returnTo}
    backLabel="Back"
  />

  <Toast
    message={data.shareError
      ? data.shareError
      : data.shared === 'pending'
        ? 'Shared file saved on this device. Review it below, then confirm the upload.'
        : data.shared === '1'
          ? 'Shared file received and sent for processing.'
          : data.shared === 'offline'
            ? 'The shared file is saved on this device. Upload it when you are online.'
            : ''}
    tone={data.shareError ? 'error' : data.shared === '1' ? 'success' : 'info'}
    token={`${data.shared ?? ''}-${data.shareError ?? ''}`}
  />

  <OfflineUploadQueue ownerUserId={data.user.id} modules={data.modules} chapters={data.chapters} />

  <UploadForm
    ownerUserId={data.user.id}
    modules={data.modules}
    chapters={data.chapters}
    presetModule={data.presets.moduleId}
    presetChapter={data.presets.chapterId}
    presetSection={data.presets.section}
    presetType={data.presets.type}
    returnTo={data.returnTo}
    camera
  />
</div>
