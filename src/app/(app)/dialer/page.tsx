import { Headphones } from "lucide-react";
import { DialerClient } from "@/components/dialer/dialer-client";
import { PageContainer, PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { leads } from "@/lib/data";

export const metadata = { title: "Power Dialer" };

export default function DialerPage() {
  return (
    <PageContainer>
      <PageHeader
        title="Power Dialer"
        description="Browser-based 3X parallel dialing with live qualification. No desk phone required."
      >
        <Badge tone="accent" className="gap-1.5">
          <Headphones className="h-3.5 w-3.5" />
          Campaign: PG&E True-Up Recovery
        </Badge>
      </PageHeader>

      <DialerClient queue={leads} />
    </PageContainer>
  );
}
