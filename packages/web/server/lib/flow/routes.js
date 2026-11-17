import express from 'express';
import { z } from 'zod';
import { createRequirementSchema, templateSchema } from './contracts.js';

const idSchema = z.string().regex(/^flw_[a-f0-9]{32}$/);
const actionSchema = z.object({
  revision: z.number().int().nonnegative(),
  ticketId: z.string().trim().min(1).optional(),
  answers: z.array(z.string().trim().min(1).max(8_000)).max(6).optional(),
}).strict();

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
  app.post('/api/openchamber/flow/:id/:action', express.json({ limit: '64kb' }), handle((req) => {
    const id = idSchema.parse(req.params.id);
    const body = actionSchema.parse(req.body);
    switch (req.params.action) {
      case 'start': return runtime.start(id);
      case 'stop': return runtime.stop(id);
      case 'answer': return runtime.answer(id, z.array(z.string().trim().min(1)).min(1).parse(body.answers), body.revision);
      case 'accept': return runtime.accept(id, body.ticketId, body.revision);
      default: throw Object.assign(new Error('Unknown Flow action'), { statusCode: 404 });
    }
  }));
};
