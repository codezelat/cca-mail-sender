"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useMemo, useState } from "react";

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

export function ContactsWorkspace() {
  const queryClient = useQueryClient();
  const { pushToast } = useToast();
  const [search, setSearch] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const [editing, setEditing] = useState<ContactRecord | null>(null);
  const [customFieldsDraft, setCustomFieldsDraft] = useState("{}");

  const contactsQuery = useQuery({
    queryKey: ["contacts-workspace", search],
    queryFn: () =>
      apiFetch<ContactsResponse>(`/api/v1/contacts?search=${encodeURIComponent(search)}`)
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
      pushToast("Saved", "Contact updated successfully.");
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
      pushToast("Deleted", "Contact removed.");
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
      pushToast("Deleted", "All contacts removed.");
      await queryClient.invalidateQueries({ queryKey: ["contacts-workspace"] });
    },
    onError: (error) => {
      pushToast("Delete Failed", error instanceof Error ? error.message : "Request failed.", "error");
    }
  });

  const contactCountLabel = useMemo(
    () => `${contactsQuery.data?.total || 0} contact${(contactsQuery.data?.total || 0) === 1 ? "" : "s"}`,
    [contactsQuery.data]
  );

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    setSearch(searchDraft);
  }

  return (
    <div className="space-y-6">
      <section className="bento-card p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-white">Contacts</h1>
            <p className="mt-1 text-sm text-slate-400">
              Search, edit, unsubscribe, and maintain your address book with delivery history.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <form className="flex items-center gap-3" onSubmit={submitSearch}>
              <input
                className="premium-input w-72"
                placeholder="Search email or name"
                value={searchDraft}
                onChange={(event) => setSearchDraft(event.target.value)}
              />
              <button className="ghost-button px-4 py-3 text-sm">Search</button>
            </form>
            <button className="ghost-button px-4 py-3 text-sm" onClick={() => deleteAllMutation.mutate()}>
              Delete All
            </button>
          </div>
        </div>
      </section>

      <section className="bento-card overflow-hidden p-6">
        <div className="mb-4 flex items-center justify-between">
          <div className="text-sm text-slate-400">{contactCountLabel}</div>
          <button className="ghost-button px-4 py-2 text-sm" onClick={() => void contactsQuery.refetch()}>
            Refresh
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-[0.18em] text-slate-500">
              <tr>
                <th className="px-4 py-3">Contact</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Custom Fields</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-slate-300">
              {(contactsQuery.data?.contacts || []).map((contact) => (
                <tr key={contact.id}>
                  <td className="px-4 py-4">
                    <div className="font-medium text-white">{contact.name}</div>
                    <div className="mt-1 text-xs text-slate-500">{contact.email}</div>
                    {contact.last_delivery_error ? (
                      <div className="mt-2 text-xs text-slate-500">{contact.last_delivery_error}</div>
                    ) : null}
                  </td>
                  <td className="px-4 py-4">
                    <StatusBadge value={contact.unsubscribed ? "unsubscribed" : contact.last_delivery_status || "subscribed"} />
                  </td>
                  <td className="px-4 py-4 text-xs text-slate-400">
                    <pre className="overflow-auto whitespace-pre-wrap font-mono">
                      {JSON.stringify(contact.custom_fields_json || {}, null, 2)}
                    </pre>
                  </td>
                  <td className="px-4 py-4">
                    <div className="flex justify-end gap-2">
                      <button
                        className="ghost-button px-4 py-2 text-xs"
                        onClick={() => {
                          setEditing(contact);
                          setCustomFieldsDraft(JSON.stringify(contact.custom_fields_json || {}, null, 2));
                        }}
                      >
                        Edit
                      </button>
                      <button className="ghost-button px-4 py-2 text-xs" onClick={() => deleteMutation.mutate(contact.id)}>
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!contactsQuery.data?.contacts?.length ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                    No contacts found.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {editing ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
          <div className="glass-card w-full max-w-2xl p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-semibold text-white">Edit Contact</h2>
              <button className="text-slate-400" onClick={() => setEditing(null)}>
                Close
              </button>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <input
                className="premium-input"
                value={editing.name}
                onChange={(event) => setEditing({ ...editing, name: event.target.value })}
                placeholder="Name"
              />
              <input
                className="premium-input"
                value={editing.email}
                onChange={(event) => setEditing({ ...editing, email: event.target.value })}
                placeholder="Email"
              />
              <textarea
                className="premium-input min-h-48 md:col-span-2 font-mono text-sm"
                value={customFieldsDraft}
                onChange={(event) => setCustomFieldsDraft(event.target.value)}
              />
              <label className="flex items-center gap-2 text-sm text-slate-300">
                <input
                  type="checkbox"
                  checked={editing.unsubscribed}
                  onChange={(event) => setEditing({ ...editing, unsubscribed: event.target.checked })}
                />
                Mark unsubscribed
              </label>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button className="ghost-button px-4 py-2 text-sm" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button
                className="premium-button px-4 py-2 text-sm"
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
                disabled={saveMutation.isPending}
              >
                {saveMutation.isPending ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
