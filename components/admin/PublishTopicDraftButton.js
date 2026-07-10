'use client';

// Publish is a public, hard-to-unring action, so the click goes through a
// confirm dialog before the server action fires. The server action is passed
// in from the (server) admin page.
export default function PublishTopicDraftButton({ action, id }) {
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!window.confirm('Publish this draft now? It goes public immediately at its /article/[slug] URL. This is hard to undo.')) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        style={{ padding: '7px 14px', fontSize: 13, fontWeight: 700, color: '#0d0d0b', background: '#d4ff00', border: 0, borderRadius: 6, cursor: 'pointer' }}
      >
        Publish
      </button>
    </form>
  );
}
