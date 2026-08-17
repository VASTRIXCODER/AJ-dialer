"use client";

import { Pencil } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { EditCampaignDialog, type EditableCampaign } from "./edit-campaign-dialog";

/**
 * Client island for the (RSC) campaign detail page: an Edit button that owns
 * the shared EditCampaignDialog. The page stays a Server Component.
 */
export function CampaignEditButton({ campaign }: { campaign: EditableCampaign }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" className="gap-2" onClick={() => setOpen(true)}>
        <Pencil className="h-4 w-4" />
        Edit
      </Button>
      {open && <EditCampaignDialog campaign={campaign} onClose={() => setOpen(false)} />}
    </>
  );
}
