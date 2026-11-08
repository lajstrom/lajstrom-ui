// The part of swagger-ui-dist's bundle the API page uses; the package ships no types.
declare module "swagger-ui-dist/swagger-ui-es-bundle.js" {
  export type SwaggerRequest = { url: string; method: string; headers: Record<string, string>; body?: unknown };
  export type SwaggerOptions = {
    domNode: HTMLElement;
    url: string;
    requestInterceptor?: (req: SwaggerRequest) => SwaggerRequest;
    tryItOutEnabled?: boolean;
    deepLinking?: boolean;
    displayRequestDuration?: boolean;
    defaultModelsExpandDepth?: number;
    docExpansion?: "list" | "full" | "none";
    filter?: boolean;
    persistAuthorization?: boolean;
  };
  const SwaggerUIBundle: (options: SwaggerOptions) => unknown;
  export default SwaggerUIBundle;
}
