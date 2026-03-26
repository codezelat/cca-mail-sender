"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { useDialog } from "@/components/providers/dialog-provider";
import { useToast } from "@/components/providers/toast-provider";
import { StatusBadge } from "@/components/ui/status-badge";
import { apiFetch } from "@/lib/api";
import type { ContactRecord } from "@/lib/types";

type ContactsResponse = {
  contacts: ContactRecord[];
  total: number;
  page: number;
  pages: number;
};

function formatDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value.endsWith("Z") ? value : `${value}Z`);
  return date.toLocaleString([], {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

export function ContactsWorkspace() {
  const queryClient = useQueryClient();
  const { pushToast } = useToast();
  const { confirm } = useDialog();
  const [search, setSearch] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const [editing, setEditing] = useState<ContactRecord | null>(null);
  const [customFieldsDraft, setCustomFieldsDraft] = useState("{}");

  const contactsQuery = useQuery({
    queryKey: ["contacts-workspace", search],
    queryFn: () => apiFetch<ContactsResponse>(`/api/v1/contacts?search=${encodeURIComponent(search)}`)
  });

  const saveMutation = useMutation({
    mutationFn: (contact: ContactRecord) =>
      apiFetch(`/api/v1/contacts/${contact.id}`, {
        method: "PUT",
        bodyJson: {
          name: contact.name,
          email: contact.email,
          custom_fields_json: contact.custom_fields_json,
          unsubscribed: contact.unsubscribed
        }
      }),
    onSuccess: async () => {
      pushToast("Contact Saved", "The contact record was updated.");
      setEditing(null);
      await queryClient.invalidateQueries({ queryKey: ["contacts-workspace"] });
    },
    onError: (error) => {
      pushToast("Save Failed", error instanceof Error ? error.message : "Request failed.", "error");
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (contactId: number) =>
      apiFetch(`/api/v1/contacts/${contactId}`, {
        method: "DELETE",
        bodyJson: {}
      }),
    onSuccess: async () => {
      pushToast("Contact Deleted", "The contact was removed.");
      await queryClient.invalidateQueries({ queryKey: ["contacts-workspace"] });
    },
    onError: (error) => {
      pushToast("Delete Failed", error instanceof Error ? error.message : "Request failed.", "error");
    }
  });

  const deleteAllMutation = useMutation({
    mutationFn: () =>
      apiFetch("/api/v1/contacts", {
        method: "DELETE",
        bodyJson: {}
      }),
    onSuccess: async () => {
      pushToast("Contacts Deleted", "All contacts were removed.");
      await queryClient.invalidateQueries({ queryKey: ["contacts-workspace"] });
    },
    onError: (error) => {
      pushToast("Delete Failed", error instanceof Error ? error.message : "Request failed.", "error");
    }
  });

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setSearch(searchDraft);
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [searchDraft]);

  return (
    <section className="view-panel">
      <div className="bento-card p-6 md:p-8">
        <div className="relative z-10 mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="bg-gradient-to-r from-white to-gray-400 bg-clip-text text-xl font-semibold text-transparent">
              Address Book
            </h2>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="text"
              placeholder="Search contacts..."
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
              className="w-64 rounded-full border border-white/10 bg-black/40 px-4 py-2 text-sm text-white outline-none focus:border-purple-500"
            />
            <button
              type="button"
              onClick={() => void contactsQuery.refetch()}
              className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs text-white transition hover:bg-white/10"
            >
              Refresh
            </button>
            <button
              type="button"
              onClick={async () => {
                const approved = await confirm({
                  title: "Delete All Contacts",
                  message: "Delete all contacts? This cannot be undone."
                });
                if (approved) {
                  deleteAllMutation.mutate();
                }
              }}
              className="rounded-full border border-red-500/20 bg-red-500/10 px-4 py-2 text-xs text-red-400 transition hover:bg-red-500/20"
            >
              Wipe All
            </button>
          </div>
        </div>

        <div className="relative z-10 overflow-x-auto rounded-xl border border-white/5 bg-black/20">
          <table className="w-full whitespace-nowrap text-left text-sm">
            <thead className="bg-white/5 text-xs uppercase tracking-wider text-gray-500">
              <tr>
                <th className="px-5 py-3">Contact</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Data</th>
                <th className="px-5 py-3">Last Active</th>
                <th className="px-5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-gray-300">
              {(contactsQuery.data?.contacts || []).map((contact) => (
                <tr key={contact.id}>
                  <td className="px-5 py-4">
                    <div className="font-medium text-white">{contact.name || "There"}</div>
                    <div className="mt-1 text-xs text-gray-500">{contact.email}</div>
                  </td>
                  <td className="px-5 py-4">
                    <StatusBadge
                      value={contact.unsubscribed ? "unsubscribed" : contact.last_delivery_status || "subscribed"}
                    />
                  </td>
                  <td className="px-5 py-4 text-gray-400">
                    <div>{Object.keys(contact.custom_fields_json || {}).length} fields</div>
                  </td>
                  <td className="px-5 py-4 text-gray-400">
                    <div>{contact.last_delivery_status || "—"}</div>
                    <div className="mt-1 text-xs text-gray-500">
                      {contact.last_delivery_error || formatDate(contact.updated_at)}
                    </div>
                  </td>
                  <td className="px-5 py-4 text-right">
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setEditing(contact);
                          setCustomFieldsDraft(JSON.stringify(contact.custom_fields_json || {}, null, 2));
                        }}
                        className="rounded-full border border-white/10 bg-white/[0.05] px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-white transition hover:bg-white/10"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          const approved = await confirm({
                            title: "Delete Contact",
                            message: "Delete this contact?"
                          });
                          if (approved) {
                            deleteMutation.mutate(contact.id);
                          }
                        }}
                        className="rounded-full border border-red-500/20 bg-red-500/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-red-500 transition hover:bg-red-500/20"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!contactsQuery.data?.contacts?.length ? (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-gray-500">
                    No contacts found.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {editing ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0a0a0a] p-6 shadow-2xl">
            <div className="mb-6 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white">Edit Contact</h3>
              <button type="button" onClick={() => setEditing(null)} className="text-gray-500 transition hover:text-white">
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-xs text-gray-500">Name</label>
                <input
                  type="text"
                  value={editing.name || ""}
                  onChange={(event) => setEditing({ ...editing, name: event.target.value })}
                  className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-purple-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-500">Email</label>
                <input
                  type="email"
                  value={editing.email || ""}
                  onChange={(event) => setEditing({ ...editing, email: event.target.value })}
                  className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-purple-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-500">Custom Fields (JSON)</label>
                <textarea
                  spellCheck="false"
                  value={customFieldsDraft}
                  onChange={(event) => setCustomFieldsDraft(event.target.value)}
                  className="h-32 w-full resize-none rounded-lg border border-white/10 bg-black/40 px-3 py-2 font-mono text-xs text-white outline-none focus:border-purple-500"
                />
              </div>
              <label className="flex cursor-pointer items-center gap-2 pt-2 text-sm text-gray-300">
                <input
                  type="checkbox"
                  checked={editing.unsubscribed}
                  onChange={(event) => setEditing({ ...editing, unsubscribed: event.target.checked })}
                  className="h-4 w-4 rounded border-white/10 bg-black/50 accent-purple-500"
                />
                Unsubscribed status
              </label>
              <button
                type="button"
                disabled={saveMutation.isPending}
                onClick={() => {
                  try {
                    saveMutation.mutate({
                      ...editing,
                      custom_fields_json: JSON.parse(customFieldsDraft || "{}")
                    });
                  } catch {
                    pushToast("Invalid JSON", "Custom fields must be valid JSON.", "error");
                  }
                }}
                className="mt-4 w-full rounded-full bg-white py-2 text-sm font-semibold text-black transition hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saveMutation.isPending ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
