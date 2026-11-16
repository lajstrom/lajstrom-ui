// Signs in through the form, as a person does: the screens need it to work (playwright.config.ts).

import { signIn, test } from "./test";

test("signs in with a password", async ({ page }) => {
  await signIn(page);
});
