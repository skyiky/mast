/**
 * PermissionCard — amber-bordered permission approval card.
 * Shows description + [deny]/[approve] buttons for pending permissions.
 * Shows status indicator for approved/denied.
 */

import { memo, useState } from "react";
import type { PermissionRequest } from "../lib/types.js";

interface PermissionCardProps {
  permission: PermissionRequest;
  onApprove: (permId: string) => void;
  onDeny: (permId: string) => void;
}

function PermissionCardInner({
  permission,
  onApprove,
  onDeny,
}: PermissionCardProps) {
  const [loading, setLoading] = useState(false);
  const isPending = permission.status === "pending";

  const handleApprove = async () => {
    setLoading(true);
    onApprove(permission.id);
  };

  const handleDeny = async () => {
    setLoading(true);
    onDeny(permission.id);
  };

  return (
    <div className="permission-card">
      <div className="permission-body">
        <div className="permission-header">permission required</div>
        <div className="permission-description">{permission.description}</div>
      </div>

      {isPending && (
        <div className="permission-actions">
          <button
            className="permission-btn deny"
            onClick={handleDeny}
            disabled={loading}
          >
            [deny]
          </button>
          <button
            className="permission-btn approve"
            onClick={handleApprove}
            disabled={loading}
          >
            {loading ? "..." : "[approve]"}
          </button>
        </div>
      )}

      {permission.status === "approved" && (
        <div className="permission-status approved">approved</div>
      )}

      {permission.status === "denied" && (
        <div className="permission-status denied">denied</div>
      )}
    </div>
  );
}

export const PermissionCard = memo(PermissionCardInner);
PermissionCard.displayName = "PermissionCard";
