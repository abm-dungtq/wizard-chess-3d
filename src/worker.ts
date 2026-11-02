import {
  defaultRoomStore,
  handleFeedbackApiRequest,
  handleRoomApiRequest,
  type FeedbackSheetConfig
} from './roomStore.ts';

export interface WorkerEnv extends FeedbackSheetConfig {
  ASSETS?: {
    fetch(request: Request): Promise<Response>;
  };
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/rooms')) {
      const apiRes = await handleRoomApiRequest(request, defaultRoomStore);
      if (apiRes) return apiRes;
    }

    if (url.pathname.startsWith('/api/feedback')) {
      const fbRes = await handleFeedbackApiRequest(request, env);
      if (fbRes) return fbRes;
    }

    if (env?.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response('Not Found', { status: 404 });
  }
};
