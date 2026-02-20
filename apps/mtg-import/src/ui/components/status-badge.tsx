import { SemanticChip } from "@saleor/apps-ui";

type JobStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";

const statusVariantMap: Record<JobStatus, "default" | "warning" | "error" | "success"> = {
  PENDING: "default",
  RUNNING: "warning",
  COMPLETED: "success",
  FAILED: "error",
  CANCELLED: "default",
};

interface StatusBadgeProps {
  status: string;
}

export const StatusBadge = ({ status }: StatusBadgeProps) => {
  const variant = statusVariantMap[status as JobStatus] ?? "default";

  return <SemanticChip variant={variant}>{status}</SemanticChip>;
};
