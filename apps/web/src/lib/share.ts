import { toast } from "sonner";

/** Copy a link to the clipboard and confirm with a toast. */
export async function copyLink(url: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(url);
    toast("Linkki kopioitu leikepöydälle");
  } catch {
    toast("Kopiointi ei onnistunut");
  }
}
