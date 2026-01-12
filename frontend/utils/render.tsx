import type { ComponentType, JSX } from "preact";

type RenderableContext = {
  req: Request;
  params?: Record<string, string>;
  render: (element: JSX.Element) => Response | Promise<Response>;
};

type PageLikeProps<TData> = {
  data: TData;
  url: string;
  params?: Record<string, string>;
};

export function renderPage<TData>(
  ctx: RenderableContext,
  Page: ComponentType<PageLikeProps<TData>>,
  data: TData,
) {
  return ctx.render(<Page data={data} url={ctx.req.url} params={ctx.params} />);
}
