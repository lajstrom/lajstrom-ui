/** URL parameter of a facet: deb.suite → suite, maven.packaging → packaging. */
export const facetParam = (key: string): string => key.split(".").pop() ?? key;

/** cp312-cp312-manylinux_2_17_x86_64 is long; the table shows a short form, the tooltip the full one. */
export function variantShort(v: string): string {
  if (v === "py3-none-any") return "py3";
  const m = v.match(/^(cp\d+)-[^-]+-(.+)$/);
  if (m) {
    const platform = m[2]!
      .replace(/manylinux_\d+_\d+_/, "linux_")
      .replace(/macosx_\d+_\d+_/, "macos_")
      .replace("x86_64", "x64");
    return `${m[1]} ${platform}`;
  }
  return v;
}
