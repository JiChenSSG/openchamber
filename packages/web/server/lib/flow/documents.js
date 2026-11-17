const conflict = (message) => Object.assign(new Error(message), { statusCode: 409 });

/** Metadata only: board refreshes and agent directories never copy document bodies. */
export const documentIndex = (documents) => documents.map(({ content, ...metadata }) => ({ ...metadata, characters: content.length }));

export const readDocument = (documents, { documentId, version }) => {
  const document = documents.findLast((entry) => entry.id === documentId && (version === undefined || entry.version === version));
  if (!document) throw Object.assign(new Error('Requirement document not found'), { statusCode: 404 });
  return document;
};

/** Called inside the store's serialized draft mutation, including version checks. */
export const appendDocument = (documents, input) => {
  const previous = documents.findLast((entry) => entry.id === input.id);
  if ((previous?.version ?? 0) !== input.version) throw conflict('Document changed; read its latest version before writing');
  const document = { ...input, version: input.version + 1, createdAt: Date.now() };
  documents.push(document);
  return document;
};

export const archiveNodeResult = (record, { node, ticketId, runId }, result) => {
  const id = `result-${node}-${ticketId ?? 'requirement'}`;
  if (record.documents.some((entry) => entry.id === id && entry.runId === runId)) return;
  const kind = { clarify: 'clarification', develop: 'handoff', verify: 'verification' }[node] ?? node;
  appendDocument(record.documents, {
    id, version: record.documents.findLast((entry) => entry.id === id)?.version ?? 0,
    title: `${node}${ticketId ? `: ${ticketId}` : ''}`, kind, content: JSON.stringify(result, null, 2),
    status: 'confirmed', node, ticketId, runId, sessionId: null,
  });
  // Notes become eligible for handoff only after their producing node validates.
  for (const document of record.documents) if (document.runId === runId) document.status = 'confirmed';
};
