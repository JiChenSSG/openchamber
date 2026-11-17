import express from 'express';
import { z } from 'zod';
import { createRequirementSchema, templateSchema, requirementIdSchema, requirementActionSchema } from './contracts.js';

/** Auth and local-route ordering are inherited from the feature route composition. */
export const registerFlowRoutes = (app, runtime) => {
  const handle = (work) => async (req, res) => {
    try { return res.json(await work(req)); }
    catch (error) {
      const status = error instanceof z.ZodError ? 400 : error.statusCode ?? 500;
      return res.status(status).json({ error: error instanceof z.ZodError ? error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ').slice(0, 2_000) : error.message });
    }
  };
  app.get('/api/openchamber/flow', handle((req) => runtime.list(z.string().trim().min(1).parse(req.query.directory))));
  app.get('/api/openchamber/flow/template', handle(() => runtime.template()));
  app.put('/api/openchamber/flow/template', express.json({ limit: '256kb' }), handle((req) => runtime.setTemplate(templateSchema.parse(req.body))));
  app.post('/api/openchamber/flow', express.json({ limit: '256kb' }), handle((req) => runtime.create(createRequirementSchema.parse(req.body))));
  app.get('/api/openchamber/flow/:id/documents', handle((req) => runtime.documents(requirementIdSchema.parse(req.params.id))));
  app.get('/api/openchamber/flow/:id/document', handle((req) => runtime.document(requirementIdSchema.parse(req.params.id), {
    documentId: req.query.documentId,
    version: req.query.version === undefined ? undefined : z.coerce.number().int().positive().parse(req.query.version),
  })));
  app.post('/api/openchamber/flow/:id/:action', express.json({ limit: '64kb' }), handle((req) => {
    const id = requirementIdSchema.parse(req.params.id);
    const body = requirementActionSchema.parse(req.body);
    switch (req.params.action) {
      case 'start': return runtime.start(id);
      case 'stop': return runtime.stop(id);
      case 'answer': return runtime.answer(id, z.array(z.string().trim().min(1)).min(1).parse(body.answers), body.revision, body.resume);
      case 'accept': return runtime.accept(id, body.ticketId, body.revision);
      default: throw Object.assign(new Error('Unknown Flow action'), { statusCode: 404 });
    }
  }));
};
