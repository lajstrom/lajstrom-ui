/** Where to go after sign-in: only a path of this UI. An absolute URL, a //host or a /\host in
 * ?redirect would send the user to another site (an open redirect). */
export function safeRedirect(redirect: string | undefined): string {
  if (!redirect || !redirect.startsWith("/") || redirect.startsWith("//") || redirect.startsWith("/\\")) return "/";
  return redirect;
}
