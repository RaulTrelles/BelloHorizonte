"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  Plus,
  MapPin,
  Users,
  Mic,
  Sparkles,
  Trash2,
  FileText,
  Printer,
  Save,
  ShieldCheck,
  CheckCircle2,
  Clock,
  Loader2,
  AlertCircle,
  RefreshCw,
  Hash,
  FileCheck2,
  ListChecks,
  Copy,
  Check,
  ExternalLink,
  MessageCircle,
  UserCheck,
} from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import type {
  AttendanceResponse,
  GroupMemberName,
  MeetingAgreement,
  MeetingAttendanceRow,
  MeetingRow,
  MeetingStatus,
  MemberRole,
  MinuteRow,
  MinuteSignatureRow,
  MinuteSignatureType,
  MinuteStatus,
  RecordingRow,
  RecordingStatus,
  TranscriptRow,
} from "@/types/database";
import { formatDateTimePE } from "@/lib/format";

interface MeetingsTabProps {
  groupId: string;
  groupName: string;
  currentUserId: string;
  currentRole: MemberRole;
}

const MEETING_STATUS_META: Record<
  MeetingStatus,
  { label: string; badgeClass: string }
> = {
  programada: {
    label: "Programada",
    badgeClass: "bg-brand-100 text-brand-800 ring-1 ring-inset ring-brand-200",
  },
  en_curso: {
    label: "En curso",
    badgeClass: "bg-amber-100 text-amber-800 ring-1 ring-inset ring-amber-200",
  },
  finalizada: {
    label: "Finalizada",
    badgeClass:
      "bg-emerald-100 text-emerald-800 ring-1 ring-inset ring-emerald-200",
  },
  cancelada: {
    label: "Cancelada",
    badgeClass: "bg-slate-200 text-slate-700 ring-1 ring-inset ring-slate-300",
  },
};

const ATTENDANCE_LABELS: Record<
  AttendanceResponse,
  { label: string; badgeClass: string }
> = {
  asistire: {
    label: "Asistiré",
    badgeClass: "bg-emerald-100 text-emerald-800",
  },
  no_asistire: {
    label: "No asistiré",
    badgeClass: "bg-red-100 text-red-800",
  },
  pendiente: {
    label: "Pendiente",
    badgeClass: "bg-slate-100 text-slate-700",
  },
};

const RECORDING_STATUS_META: Record<
  RecordingStatus,
  { label: string; badgeClass: string }
> = {
  grabando: {
    label: "Grabando",
    badgeClass: "bg-red-100 text-red-800",
  },
  subido: {
    label: "Subido",
    badgeClass: "bg-brand-100 text-brand-800",
  },
  transcribiendo: {
    label: "Transcribiendo",
    badgeClass: "bg-amber-100 text-amber-800",
  },
  transcrito: {
    label: "Transcrito",
    badgeClass: "bg-emerald-100 text-emerald-800",
  },
  error: {
    label: "Error",
    badgeClass: "bg-red-100 text-red-800",
  },
  eliminado: {
    label: "Audio eliminado (Ley 29733)",
    badgeClass: "bg-slate-200 text-slate-700",
  },
};

const MINUTE_STATUS_META: Record<
  MinuteStatus,
  { label: string; badgeClass: string }
> = {
  borrador: {
    label: "Borrador",
    badgeClass: "bg-slate-200 text-slate-800",
  },
  revision: {
    label: "En revisión",
    badgeClass: "bg-amber-100 text-amber-800",
  },
  aprobada: {
    label: "Aprobada",
    badgeClass: "bg-emerald-100 text-emerald-800",
  },
  asentada_en_libro: {
    label: "Asentada en libro",
    badgeClass: "bg-brand-100 text-brand-800",
  },
};

const SIGNATURE_TYPE_LABELS: Record<MinuteSignatureType, string> = {
  acuse_recibo: "Acuse de recibido",
  conformidad_simple: "Conformidad digital",
};

/**
 * Extrae temas tratados y acuerdos (con responsable y plazo) desde el contenido del acta
 * en formato Markdown o texto estructurado generado por IA o redactado manualmente.
 */
function parseStructuredMinute(contenido: string): {
  temasTratados: string[];
  acuerdos: MeetingAgreement[];
} {
  const temasTratados: string[] = [];
  const acuerdos: MeetingAgreement[] = [];

  if (!contenido.trim()) {
    return { temasTratados, acuerdos };
  }

  const lines = contenido.split(/\r?\n/);
  let section: "none" | "temas" | "acuerdos" = "none";

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const lower = line.toLowerCase();
    if (/^#{1,4}\s*/.test(line) || /^[A-ZÁÉÍÓÚÑ\s]{4,}:$/.test(line)) {
      if (
        lower.includes("tema") ||
        lower.includes("orden del día") ||
        lower.includes("orden del dia") ||
        lower.includes("desarrollo")
      ) {
        section = "temas";
        continue;
      }
      if (lower.includes("acuerdo") || lower.includes("compromiso")) {
        section = "acuerdos";
        continue;
      }
      if (/^#{1,4}\s*/.test(line)) {
        section = "none";
        continue;
      }
    }

    // Parseo de tabla Markdown en sección de acuerdos: | Acuerdo | Responsable | Plazo |
    if (section === "acuerdos" && line.startsWith("|") && line.endsWith("|")) {
      const cells = line
        .slice(1, -1)
        .split("|")
        .map((c) => c.trim());
      if (
        cells.length >= 1 &&
        !cells[0].toLowerCase().includes("acuerdo") &&
        !/^[-:\s]+$/.test(cells[0])
      ) {
        acuerdos.push({
          acuerdo: cells[0],
          responsable: cells[1] || "Directiva",
          plazo: cells[2] || "Por definir",
        });
      }
      continue;
    }

    const bulletMatch = line.match(/^(?:[-*•]|\d+[.)])\s+(.+)$/);
    if (!bulletMatch) continue;
    const itemText = bulletMatch[1].trim();

    if (section === "temas") {
      temasTratados.push(itemText);
    } else if (section === "acuerdos") {
      const respMatch = itemText.match(
        /responsable\s*:\s*([^|;—–-]+?)(?=\s*(?:\||;|—|–|plazo\s*:|$))/i
      );
      const plazoMatch = itemText.match(
        /plazo\s*:\s*([^|;—–]+?)(?=\s*(?:\||;|—|–|$))/i
      );
      const cleanAcuerdo = itemText
        .replace(/\(?\s*responsable\s*:[^|;)]+\)?/gi, "")
        .replace(/\(?\s*plazo\s*:[^|;)]+\)?/gi, "")
        .replace(/[\s|;—–-]+$/, "")
        .trim();

      acuerdos.push({
        acuerdo: cleanAcuerdo || itemText,
        responsable: respMatch?.[1]?.trim() || "Directiva",
        plazo: plazoMatch?.[1]?.trim() || "Por definir",
      });
    }
  }

  return { temasTratados, acuerdos };
}

async function computeSha256Hex(text: string): Promise<string | null> {
  if (typeof window === "undefined" || !window.crypto?.subtle) {
    return null;
  }
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await window.crypto.subtle.digest("SHA-256", data);
  const bytes = Array.from(new Uint8Array(hashBuffer));
  return bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
}

function toDatetimeLocalValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

export function MeetingsTab({
  groupId,
  groupName,
  currentUserId,
  currentRole,
}: MeetingsTabProps) {
  const [meetings, setMeetings] = useState<MeetingRow[]>([]);
  const [selectedMeetingId, setSelectedMeetingId] = useState<string | null>(
    null
  );
  const [memberNames, setMemberNames] = useState<Record<string, string>>({});

  // Detalle de la reunión seleccionada
  const [attendance, setAttendance] = useState<MeetingAttendanceRow[]>([]);
  const [recordings, setRecordings] = useState<RecordingRow[]>([]);
  const [transcriptsByRec, setTranscriptsByRec] = useState<
    Record<string, TranscriptRow[]>
  >({});
  const [minute, setMinute] = useState<MinuteRow | null>(null);
  const [signatures, setSignatures] = useState<MinuteSignatureRow[]>([]);

  // Estados de carga y mensajes
  const [loadingList, setLoadingList] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Formulario nueva reunión
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newTitulo, setNewTitulo] = useState("");
  const [newFecha, setNewFecha] = useState("");
  const [newLugar, setNewLugar] = useState("");
  const [newAgenda, setNewAgenda] = useState("");
  const [creatingMeeting, setCreatingMeeting] = useState(false);

  // Editor de acta
  const [minuteContent, setMinuteContent] = useState("");
  const [minuteEstado, setMinuteEstado] = useState<MinuteStatus>("borrador");
  const [minutePlazoObs, setMinutePlazoObs] = useState("");
  const [savingMinute, setSavingMinute] = useState(false);
  const [generatingAI, setGeneratingAI] = useState(false);
  const [purgingAudio, setPurgingAudio] = useState(false);
  const [updatingMeetingStatus, setUpdatingMeetingStatus] = useState(false);
  const [togglingAttendanceId, setTogglingAttendanceId] = useState<
    string | null
  >(null);

  // Doble confirmación directiva + PDF oficial + WhatsApp
  const [confirmingRole, setConfirmingRole] = useState<
    "presidente" | "secretario" | null
  >(null);
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [serverWhatsappText, setServerWhatsappText] = useState<string | null>(
    null
  );
  const [copiedWa, setCopiedWa] = useState(false);
  const copiedWaTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copiedWaTimeoutRef.current !== null) {
        clearTimeout(copiedWaTimeoutRef.current);
      }
    };
  }, []);

  const loadMeetingsList = useCallback(async () => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    setLoadingList(true);
    setErrorMsg(null);
    try {
      const [meetingsRes, namesRes] = await Promise.all([
        supabase
          .from("meetings")
          .select(
            "id, group_id, titulo, fecha, lugar, agenda, estado, created_by, created_at"
          )
          .eq("group_id", groupId)
          .order("fecha", { ascending: false }),
        supabase.rpc("get_group_member_names", { p_group_id: groupId }),
      ]);

      if (meetingsRes.error) throw meetingsRes.error;

      const list = (meetingsRes.data ?? []) as MeetingRow[];
      setMeetings(list);

      const namesMap: Record<string, string> = {};
      if (!namesRes.error && Array.isArray(namesRes.data)) {
        for (const item of namesRes.data as GroupMemberName[]) {
          namesMap[item.user_id] = item.nombre || "Vecino";
        }
      }
      setMemberNames(namesMap);

      setSelectedMeetingId((prev) => {
        if (prev && list.some((m) => m.id === prev)) return prev;
        return list.length > 0 ? list[0].id : null;
      });
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : "No se pudieron cargar las reuniones del grupo."
      );
    } finally {
      setLoadingList(false);
    }
  }, [groupId]);

  const loadMeetingDetail = useCallback(async (meetingId: string) => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    setLoadingDetail(true);
    setErrorMsg(null);
    try {
      const [attRes, recRes, minRes] = await Promise.all([
        supabase
          .from("meeting_attendance")
          .select("id, meeting_id, user_id, respuesta, asistio, updated_at")
          .eq("meeting_id", meetingId)
          .order("updated_at", { ascending: false }),
        supabase
          .from("recordings")
          .select(
            "id, meeting_id, storage_path, consentimientos, estado, created_at"
          )
          .eq("meeting_id", meetingId)
          .order("created_at", { ascending: true }),
        supabase
          .from("minutes")
          .select(
            "id, meeting_id, contenido, estado, pdf_path, hash_sha256, plazo_observaciones_hasta, aprobada_por, aprobada_presidente_por, aprobada_presidente_at, aprobada_secretario_por, aprobada_secretario_at, created_at"
          )
          .eq("meeting_id", meetingId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      if (attRes.error) throw attRes.error;
      if (recRes.error) throw recRes.error;
      if (minRes.error) throw minRes.error;

      setAttendance((attRes.data ?? []) as MeetingAttendanceRow[]);

      const recRows = (recRes.data ?? []) as RecordingRow[];
      setRecordings(recRows);

      if (recRows.length > 0) {
        const recIds = recRows.map((r) => r.id);
        const { data: transData, error: transErr } = await supabase
          .from("transcripts")
          .select("id, recording_id, texto, proveedor, created_at")
          .in("recording_id", recIds)
          .order("created_at", { ascending: true });

        if (transErr) throw transErr;

        const grouped: Record<string, TranscriptRow[]> = {};
        for (const t of (transData ?? []) as TranscriptRow[]) {
          if (!grouped[t.recording_id]) grouped[t.recording_id] = [];
          grouped[t.recording_id].push(t);
        }
        setTranscriptsByRec(grouped);
      } else {
        setTranscriptsByRec({});
      }

      const foundMinute = (minRes.data as MinuteRow | null) ?? null;
      setMinute(foundMinute);
      setMinuteContent(foundMinute?.contenido ?? "");
      setMinuteEstado(foundMinute?.estado ?? "borrador");
      setMinutePlazoObs(
        toDatetimeLocalValue(foundMinute?.plazo_observaciones_hasta ?? null)
      );
      setServerWhatsappText(null);

      if (foundMinute?.pdf_path) {
        const { data } = supabase.storage
          .from("meeting-minutes-pdf")
          .getPublicUrl(foundMinute.pdf_path);
        setPdfUrl(
          data.publicUrl && /^https?:\/\//i.test(data.publicUrl)
            ? data.publicUrl
            : null
        );
      } else {
        setPdfUrl(null);
      }

      if (foundMinute) {
        const { data: sigData, error: sigErr } = await supabase
          .from("minute_signatures")
          .select(
            "id, minute_id, user_id, tipo, firmado_at, firma_texto, dispositivo_meta"
          )
          .eq("minute_id", foundMinute.id)
          .order("firmado_at", { ascending: true });

        if (sigErr) throw sigErr;
        setSignatures((sigData ?? []) as MinuteSignatureRow[]);
      } else {
        setSignatures([]);
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : "No se pudo cargar el detalle de la reunión."
      );
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  useEffect(() => {
    loadMeetingsList();
  }, [loadMeetingsList]);

  useEffect(() => {
    if (selectedMeetingId) {
      loadMeetingDetail(selectedMeetingId);
    } else {
      setAttendance([]);
      setRecordings([]);
      setTranscriptsByRec({});
      setMinute(null);
      setSignatures([]);
      setMinuteContent("");
      setMinuteEstado("borrador");
      setMinutePlazoObs("");
    }
  }, [selectedMeetingId, loadMeetingDetail]);

  const selectedMeeting = useMemo(
    () => meetings.find((m) => m.id === selectedMeetingId) ?? null,
    [meetings, selectedMeetingId]
  );

  const structured = useMemo(
    () => parseStructuredMinute(minuteContent),
    [minuteContent]
  );

  async function handleCreateMeeting(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (!newTitulo.trim() || !newFecha) {
      setErrorMsg("Completa el título y la fecha/hora de la reunión.");
      return;
    }

    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    setCreatingMeeting(true);
    try {
      const isoDate = new Date(newFecha).toISOString();
      const { data, error } = await supabase
        .from("meetings")
        .insert({
          group_id: groupId,
          titulo: newTitulo.trim(),
          fecha: isoDate,
          lugar: newLugar.trim() || null,
          agenda: newAgenda.trim() || null,
          estado: "programada",
          created_by: currentUserId,
        })
        .select(
          "id, group_id, titulo, fecha, lugar, agenda, estado, created_by, created_at"
        )
        .single();

      if (error) throw error;

      setNewTitulo("");
      setNewFecha("");
      setNewLugar("");
      setNewAgenda("");
      setShowCreateForm(false);
      setSuccessMsg("Reunión convocada correctamente.");
      await loadMeetingsList();
      if (data?.id) {
        setSelectedMeetingId(data.id as string);
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "No se pudo crear la reunión."
      );
    } finally {
      setCreatingMeeting(false);
    }
  }

  async function handleUpdateMeetingStatus(nextStatus: MeetingStatus) {
    if (!selectedMeeting) return;
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    setUpdatingMeetingStatus(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const { error } = await supabase
        .from("meetings")
        .update({ estado: nextStatus })
        .eq("id", selectedMeeting.id)
        .eq("group_id", groupId);

      if (error) throw error;
      setMeetings((prev) =>
        prev.map((m) =>
          m.id === selectedMeeting.id ? { ...m, estado: nextStatus } : m
        )
      );
      setSuccessMsg(
        `Estado de reunión actualizado a "${MEETING_STATUS_META[nextStatus].label}".`
      );
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : "No se pudo actualizar el estado de la reunión."
      );
    } finally {
      setUpdatingMeetingStatus(false);
    }
  }

  async function handleToggleAsistio(row: MeetingAttendanceRow) {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    setTogglingAttendanceId(row.id);
    setErrorMsg(null);
    try {
      const nextValue = !row.asistio;
      const { error } = await supabase
        .from("meeting_attendance")
        .update({ asistio: nextValue })
        .eq("id", row.id);

      if (error) throw error;
      setAttendance((prev) =>
        prev.map((item) =>
          item.id === row.id ? { ...item, asistio: nextValue } : item
        )
      );
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : "No se pudo actualizar la asistencia."
      );
    } finally {
      setTogglingAttendanceId(null);
    }
  }

  async function handleGenerateMinuteAI() {
    if (!selectedMeeting) return;
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    setGeneratingAI(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const { data, error } = await supabase.functions.invoke(
        "generate-meeting-minute",
        {
          body: {
            meetingId: selectedMeeting.id,
            action: "generate",
          },
        }
      );

      if (error) throw error;

      const fnError =
        data && typeof data === "object" && "error" in data
          ? String((data as { error: unknown }).error)
          : null;
      if (fnError) {
        throw new Error(fnError);
      }

      setSuccessMsg(
        "Borrador de acta generado con IA. Revisa el contenido y guarda los ajustes."
      );
      await loadMeetingDetail(selectedMeeting.id);
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : "No se pudo generar el borrador de acta con IA."
      );
    } finally {
      setGeneratingAI(false);
    }
  }

  async function handlePurgeAudio() {
    if (!selectedMeeting) return;
    const confirmed = window.confirm(
      "¿Eliminar permanentemente todos los archivos de audio de esta reunión en Supabase Storage (cumplimiento Ley 29733)? Las transcripciones y el acta se conservarán."
    );
    if (!confirmed) return;

    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    setPurgingAudio(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const { data, error } = await supabase.functions.invoke(
        "generate-meeting-minute",
        {
          body: {
            meetingId: selectedMeeting.id,
            action: "purge_audio",
          },
        }
      );

      if (error) throw error;

      const fnError =
        data && typeof data === "object" && "error" in data
          ? String((data as { error: unknown }).error)
          : null;
      if (fnError) {
        throw new Error(fnError);
      }

      setSuccessMsg(
        "Audios eliminados de Storage conforme a la Ley N.° 29733."
      );
      await loadMeetingDetail(selectedMeeting.id);
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : "No se pudieron eliminar los audios de Storage."
      );
    } finally {
      setPurgingAudio(false);
    }
  }

  async function handleSaveMinute(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedMeeting) return;

    if (!minuteContent.trim()) {
      setErrorMsg("El contenido del acta no puede estar vacío.");
      return;
    }

    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    setSavingMinute(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const cleanContent = minuteContent.trim();
      const computedHash = await computeSha256Hex(cleanContent);
      const plazoIso = minutePlazoObs
        ? new Date(minutePlazoObs).toISOString()
        : null;
      const aprobadaPor =
        minuteEstado === "aprobada" || minuteEstado === "asentada_en_libro"
          ? minute?.aprobada_por ?? currentUserId
          : null;

      if (minute) {
        const { error } = await supabase
          .from("minutes")
          .update({
            contenido: cleanContent,
            estado: minuteEstado,
            hash_sha256: computedHash ?? minute.hash_sha256,
            plazo_observaciones_hasta: plazoIso,
            aprobada_por: aprobadaPor,
          })
          .eq("id", minute.id);

        if (error) throw error;
      } else {
        const { error } = await supabase.from("minutes").insert({
          meeting_id: selectedMeeting.id,
          contenido: cleanContent,
          estado: minuteEstado,
          hash_sha256: computedHash,
          plazo_observaciones_hasta: plazoIso,
          aprobada_por: aprobadaPor,
        });

        if (error) throw error;
      }

      setSuccessMsg("Acta guardada y hash SHA-256 actualizado correctamente.");
      await loadMeetingDetail(selectedMeeting.id);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "No se pudo guardar el acta."
      );
    } finally {
      setSavingMinute(false);
    }
  }

  function handlePrintMinute() {
    window.print();
  }

  async function handleConfirmByRole(role: "presidente" | "secretario") {
    if (!minute || !selectedMeeting) return;
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    setConfirmingRole(role);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const { error } = await supabase.rpc("confirm_minute_by_role", {
        p_minute_id: minute.id,
        p_as_role: role,
      });

      if (error) throw error;

      setSuccessMsg(
        role === "presidente"
          ? "Acta confirmada como Presidente correctamente."
          : "Acta confirmada como Secretario/a correctamente."
      );
      await loadMeetingDetail(selectedMeeting.id);
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : "No se pudo registrar la confirmación directiva."
      );
    } finally {
      setConfirmingRole(null);
    }
  }

  async function handleGeneratePdf() {
    if (!selectedMeeting || !minute) return;
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    setGeneratingPdf(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const { data, error } = await supabase.functions.invoke(
        "generate-meeting-minute",
        {
          body: {
            meetingId: selectedMeeting.id,
            action: "generate_pdf",
          },
        }
      );

      if (error) throw error;

      const payload = (data ?? {}) as {
        error?: unknown;
        pdfUrl?: unknown;
        pdf_url?: unknown;
        whatsappText?: unknown;
        whatsappMessage?: unknown;
      };

      if (payload.error) {
        throw new Error(String(payload.error));
      }

      const returnedUrl =
        typeof payload.pdfUrl === "string"
          ? payload.pdfUrl
          : typeof payload.pdf_url === "string"
            ? payload.pdf_url
            : null;
      const returnedWaText =
        typeof payload.whatsappText === "string"
          ? payload.whatsappText
          : typeof payload.whatsappMessage === "string"
            ? payload.whatsappMessage
            : null;

      await loadMeetingDetail(selectedMeeting.id);
      if (returnedUrl && /^https?:\/\//i.test(returnedUrl)) {
        setPdfUrl(returnedUrl);
      }
      if (returnedWaText) setServerWhatsappText(returnedWaText);

      setSuccessMsg(
        "PDF oficial generado correctamente. Ya puedes descargarlo o difundirlo al grupo de WhatsApp."
      );
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : "No se pudo generar el PDF oficial del acta."
      );
    } finally {
      setGeneratingPdf(false);
    }
  }

  const isDoubleConfirmed = Boolean(
    minute?.aprobada_presidente_at && minute?.aprobada_secretario_at
  );

  const canConfirmPresidente =
    currentRole === "presidente" || currentRole === "admin";
  const canConfirmSecretario =
    currentRole === "secretario" || currentRole === "admin";

  const whatsappMessage = useMemo(() => {
    if (serverWhatsappText) return serverWhatsappText;
    if (!selectedMeeting) return "";

    const lines: string[] = [
      `*ACTA OFICIAL — ${groupName || "Asociación Bello Horizonte"}*`,
      `📋 *Reunión:* ${selectedMeeting.titulo}`,
      `📅 *Fecha:* ${formatDateTimePE(selectedMeeting.fecha)}`,
      "✅ Aprobada por Presidente y Secretario/a.",
    ];

    if (structured.acuerdos.length > 0) {
      lines.push("", "*Resumen de acuerdos:*");
      structured.acuerdos.slice(0, 5).forEach((item, idx) => {
        const resp = item.responsable ? ` (${item.responsable})` : "";
        const plazo = item.plazo ? ` — Plazo: ${item.plazo}` : "";
        lines.push(`${idx + 1}. ${item.acuerdo}${resp}${plazo}`);
      });
    }

    if (pdfUrl) {
      lines.push("", `📄 *PDF Oficial del Acta:*\n${pdfUrl}`);
    }

    if (minute?.hash_sha256) {
      lines.push(
        "",
        `🔒 *Integridad SHA-256:* ${minute.hash_sha256.slice(0, 16)}...`
      );
    }

    return lines.join("\n");
  }, [
    serverWhatsappText,
    selectedMeeting,
    groupName,
    structured.acuerdos,
    pdfUrl,
    minute?.hash_sha256,
  ]);

  const whatsappShareUrl = useMemo(() => {
    if (!whatsappMessage) return "#";
    return `https://wa.me/?text=${encodeURIComponent(whatsappMessage)}`;
  }, [whatsappMessage]);

  async function handleCopyWhatsAppMessage() {
    if (!whatsappMessage) return;
    try {
      await navigator.clipboard.writeText(whatsappMessage);
      setCopiedWa(true);
      if (copiedWaTimeoutRef.current !== null) {
        clearTimeout(copiedWaTimeoutRef.current);
      }
      copiedWaTimeoutRef.current = setTimeout(() => {
        setCopiedWa(false);
        copiedWaTimeoutRef.current = null;
      }, 2000);
    } catch {
      // Fallback silencioso si el navegador bloquea el portapapeles
    }
  }

  const attendanceCounts = useMemo(() => {
    return {
      asistire: attendance.filter((a) => a.respuesta === "asistire").length,
      no_asistire: attendance.filter((a) => a.respuesta === "no_asistire")
        .length,
      pendiente: attendance.filter((a) => a.respuesta === "pendiente").length,
      asistio: attendance.filter((a) => a.asistio).length,
    };
  }, [attendance]);

  const activeAudioCount = useMemo(
    () => recordings.filter((r) => r.estado !== "eliminado").length,
    [recordings]
  );

  return (
    <>
      {/* ===================================================================== */}
      {/* INTERFAZ INTERACTIVA (oculta al imprimir)                              */}
      {/* ===================================================================== */}
      <div className="no-print space-y-6">
        {/* Cabecera y botón nueva reunión */}
        <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <CalendarDays
                className="h-5 w-5 text-brand-700"
                aria-hidden="true"
              />
              <h2 className="text-base font-bold text-slate-900">
                Reuniones, Grabaciones y Libro de Actas
              </h2>
            </div>
            <p className="mt-1 text-xs text-slate-600">
              Convoca reuniones, revisa asistencia y transcripciones, genera
              borradores de acta con IA y exporta el PDF oficial con hash
              SHA-256 para el libro legalizado (rol activo:{" "}
              <strong className="capitalize">{currentRole}</strong>).
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={loadMeetingsList}
              disabled={loadingList}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${loadingList ? "animate-spin" : ""}`}
              />
              Actualizar
            </button>

            <button
              type="button"
              onClick={() => setShowCreateForm((prev) => !prev)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-brand-800 px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-900"
            >
              <Plus className="h-4 w-4" />
              {showCreateForm ? "Cerrar formulario" : "Nueva reunión"}
            </button>
          </div>
        </div>

        {/* Mensajes globales */}
        {errorMsg && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
            <span>{errorMsg}</span>
          </div>
        )}

        {successMsg && (
          <div
            role="status"
            className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800"
          >
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            <span>{successMsg}</span>
          </div>
        )}

        {/* Formulario crear reunión */}
        {showCreateForm && (
          <form
            onSubmit={handleCreateMeeting}
            className="rounded-2xl border border-brand-200 bg-white p-5 shadow-sm sm:p-6"
          >
            <h3 className="text-sm font-bold text-slate-900">
              Convocar nueva reunión vecinal
            </h3>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label
                  htmlFor="meeting-titulo"
                  className="block text-xs font-semibold uppercase tracking-wide text-slate-700"
                >
                  Título de la reunión
                </label>
                <input
                  id="meeting-titulo"
                  type="text"
                  required
                  value={newTitulo}
                  onChange={(e) => setNewTitulo(e.target.value)}
                  placeholder="Ej. Asamblea Ordinaria de Seguridad Vecinal — Noviembre 2026"
                  className="mt-1.5 w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm text-slate-900 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-200"
                />
              </div>

              <div>
                <label
                  htmlFor="meeting-fecha"
                  className="block text-xs font-semibold uppercase tracking-wide text-slate-700"
                >
                  Fecha y hora
                </label>
                <input
                  id="meeting-fecha"
                  type="datetime-local"
                  required
                  value={newFecha}
                  onChange={(e) => setNewFecha(e.target.value)}
                  className="mt-1.5 w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm text-slate-900 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-200"
                />
              </div>

              <div>
                <label
                  htmlFor="meeting-lugar"
                  className="block text-xs font-semibold uppercase tracking-wide text-slate-700"
                >
                  Lugar
                </label>
                <input
                  id="meeting-lugar"
                  type="text"
                  value={newLugar}
                  onChange={(e) => setNewLugar(e.target.value)}
                  placeholder="Ej. Parque Central / Local Comunal Bello Horizonte"
                  className="mt-1.5 w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm text-slate-900 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-200"
                />
              </div>

              <div className="sm:col-span-2">
                <label
                  htmlFor="meeting-agenda"
                  className="block text-xs font-semibold uppercase tracking-wide text-slate-700"
                >
                  Agenda / Orden del día
                </label>
                <textarea
                  id="meeting-agenda"
                  rows={3}
                  value={newAgenda}
                  onChange={(e) => setNewAgenda(e.target.value)}
                  placeholder="1. Revisión de alertas del mes&#10;2. Coordinación con Serenazgo&#10;3. Acuerdos y próximos pasos"
                  className="mt-1.5 w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm text-slate-900 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-200"
                />
              </div>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowCreateForm(false)}
                className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={creatingMeeting}
                className="inline-flex items-center gap-1.5 rounded-xl bg-brand-800 px-4 py-2 text-xs font-semibold text-white hover:bg-brand-900 disabled:opacity-50"
              >
                {creatingMeeting ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Guardando...
                  </>
                ) : (
                  <>
                    <Plus className="h-3.5 w-3.5" />
                    Convocar reunión
                  </>
                )}
              </button>
            </div>
          </form>
        )}

        {/* Layout principal: Lista de reuniones + Detalle */}
        <div className="grid gap-6 lg:grid-cols-12">
          {/* Columna izquierda: listado de reuniones */}
          <div className="lg:col-span-4">
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 px-4 py-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600">
                  Reuniones ({meetings.length})
                </h3>
              </div>

              {loadingList ? (
                <div className="flex items-center justify-center gap-2 p-8 text-xs text-slate-500">
                  <Loader2 className="h-4 w-4 animate-spin text-brand-700" />
                  Cargando reuniones...
                </div>
              ) : meetings.length === 0 ? (
                <div className="p-8 text-center">
                  <CalendarDays className="mx-auto h-8 w-8 text-slate-400" />
                  <p className="mt-2 text-sm font-medium text-slate-700">
                    No hay reuniones registradas
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Crea la primera reunión usando el botón &ldquo;Nueva
                    reunión&rdquo;.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-slate-200">
                  {meetings.map((m) => {
                    const active = m.id === selectedMeetingId;
                    const meta = MEETING_STATUS_META[m.estado];
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setSelectedMeetingId(m.id)}
                        className={`block w-full p-4 text-left transition ${
                          active
                            ? "bg-brand-50/80 ring-1 ring-inset ring-brand-200"
                            : "hover:bg-slate-50"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${meta.badgeClass}`}
                          >
                            {meta.label}
                          </span>
                          <span className="text-[11px] text-slate-500">
                            {formatDateTimePE(m.fecha)}
                          </span>
                        </div>
                        <p className="mt-2 font-semibold text-slate-900">
                          {m.titulo}
                        </p>
                        {m.lugar && (
                          <p className="mt-1 inline-flex items-center gap-1 text-xs text-slate-500">
                            <MapPin className="h-3 w-3 shrink-0" />
                            <span className="truncate">{m.lugar}</span>
                          </p>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Columna derecha: detalle de la reunión seleccionada */}
          <div className="space-y-6 lg:col-span-8">
            {!selectedMeeting ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center">
                <FileText className="mx-auto h-9 w-9 text-slate-400" />
                <p className="mt-3 text-sm font-semibold text-slate-700">
                  Selecciona una reunión para ver su asistencia, grabaciones y
                  acta
                </p>
              </div>
            ) : loadingDetail ? (
              <div className="flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white p-12 text-sm text-slate-500">
                <Loader2 className="h-5 w-5 animate-spin text-brand-700" />
                Cargando detalle de la reunión...
              </div>
            ) : (
              <>
                {/* Tarjeta resumen de la reunión */}
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <span
                        className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                          MEETING_STATUS_META[selectedMeeting.estado].badgeClass
                        }`}
                      >
                        {MEETING_STATUS_META[selectedMeeting.estado].label}
                      </span>
                      <h3 className="mt-2 text-lg font-bold text-slate-900">
                        {selectedMeeting.titulo}
                      </h3>
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
                        <span className="inline-flex items-center gap-1">
                          <Clock className="h-3.5 w-3.5 text-slate-400" />
                          {formatDateTimePE(selectedMeeting.fecha)}
                        </span>
                        {selectedMeeting.lugar && (
                          <span className="inline-flex items-center gap-1">
                            <MapPin className="h-3.5 w-3.5 text-slate-400" />
                            {selectedMeeting.lugar}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <label
                        htmlFor="meeting-status-select"
                        className="sr-only"
                      >
                        Estado de la reunión
                      </label>
                      <select
                        id="meeting-status-select"
                        value={selectedMeeting.estado}
                        disabled={updatingMeetingStatus}
                        onChange={(e) =>
                          handleUpdateMeetingStatus(
                            e.target.value as MeetingStatus
                          )
                        }
                        className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 focus:border-brand-600 focus:outline-none"
                      >
                        <option value="programada">Programada</option>
                        <option value="en_curso">En curso</option>
                        <option value="finalizada">Finalizada</option>
                        <option value="cancelada">Cancelada</option>
                      </select>
                    </div>
                  </div>

                  {selectedMeeting.agenda && (
                    <div className="mt-4 rounded-xl bg-slate-50 p-3.5">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Agenda / Orden del día
                      </p>
                      <p className="mt-1 whitespace-pre-line text-sm text-slate-700">
                        {selectedMeeting.agenda}
                      </p>
                    </div>
                  )}
                </div>

                {/* Sección 1: Lista de Asistencia */}
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Users className="h-5 w-5 text-brand-700" />
                      <h4 className="text-sm font-bold text-slate-900">
                        Lista de Asistencia ({attendance.length})
                      </h4>
                    </div>

                    <div className="flex flex-wrap gap-2 text-xs">
                      <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 font-semibold text-emerald-700">
                        Asistiré: {attendanceCounts.asistire}
                      </span>
                      <span className="rounded-full bg-red-50 px-2.5 py-0.5 font-semibold text-red-700">
                        No asistiré: {attendanceCounts.no_asistire}
                      </span>
                      <span className="rounded-full bg-brand-50 px-2.5 py-0.5 font-semibold text-brand-800">
                        Presentes: {attendanceCounts.asistio}
                      </span>
                    </div>
                  </div>

                  {attendance.length === 0 ? (
                    <p className="mt-3 text-xs text-slate-500">
                      Aún no hay respuestas de asistencia registradas para esta
                      reunión.
                    </p>
                  ) : (
                    <div className="mt-4 divide-y divide-slate-100 rounded-xl border border-slate-200">
                      {attendance.map((row) => {
                        const respMeta = ATTENDANCE_LABELS[row.respuesta];
                        const vecinoName =
                          memberNames[row.user_id] ?? "Vecino registrado";
                        const busy = togglingAttendanceId === row.id;

                        return (
                          <div
                            key={row.id}
                            className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm"
                          >
                            <div className="flex items-center gap-2.5">
                              <span className="font-medium text-slate-900">
                                {vecinoName}
                              </span>
                              <span
                                className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${respMeta.badgeClass}`}
                              >
                                {respMeta.label}
                              </span>
                            </div>

                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => handleToggleAsistio(row)}
                              className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                                row.asistio
                                  ? "bg-emerald-600 text-white hover:bg-emerald-700"
                                  : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                              }`}
                            >
                              {busy ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <CheckCircle2 className="h-3 w-3" />
                              )}
                              {row.asistio ? "Asistió" : "Marcar presente"}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Sección 2: Grabaciones y Transcripciones (IA + Ley 29733) */}
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <Mic className="h-5 w-5 text-brand-700" />
                        <h4 className="text-sm font-bold text-slate-900">
                          Bloques de Audio y Transcripciones ({recordings.length}
                          )
                        </h4>
                      </div>
                      <p className="mt-1 text-xs text-slate-500">
                        Retención mínima Ley 29733: elimina los audios de
                        Storage tras generar y revisar el borrador del acta.
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={handleGenerateMinuteAI}
                        disabled={generatingAI || purgingAudio}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-brand-800 px-3.5 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-900 disabled:opacity-50"
                      >
                        {generatingAI ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Sparkles className="h-3.5 w-3.5" />
                        )}
                        Generar borrador de acta (IA)
                      </button>

                      <button
                        type="button"
                        onClick={handlePurgeAudio}
                        disabled={
                          purgingAudio ||
                          generatingAI ||
                          activeAudioCount === 0
                        }
                        className="inline-flex items-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2 text-xs font-semibold text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {purgingAudio ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                        Eliminar audios de Storage (Ley 29733)
                      </button>
                    </div>
                  </div>

                  {recordings.length === 0 ? (
                    <p className="mt-4 rounded-xl bg-slate-50 p-4 text-xs text-slate-600">
                      No hay grabaciones registradas para esta reunión. Puedes
                      grabar bloques de audio con notificación visible desde la
                      App Android o redactar el acta manualmente abajo.
                    </p>
                  ) : (
                    <div className="mt-4 space-y-3">
                      {recordings.map((rec, idx) => {
                        const recMeta = RECORDING_STATUS_META[rec.estado];
                        const recTranscripts = transcriptsByRec[rec.id] ?? [];
                        return (
                          <div
                            key={rec.id}
                            className="rounded-xl border border-slate-200 bg-slate-50/70 p-4"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-bold text-slate-800">
                                  Bloque #{idx + 1}
                                </span>
                                <span
                                  className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${recMeta.badgeClass}`}
                                >
                                  {recMeta.label}
                                </span>
                              </div>
                              <span className="text-[11px] text-slate-500">
                                {formatDateTimePE(rec.created_at)}
                              </span>
                            </div>

                            {recTranscripts.length > 0 ? (
                              <div className="mt-2.5 space-y-2">
                                {recTranscripts.map((t) => (
                                  <div
                                    key={t.id}
                                    className="rounded-lg border border-slate-200 bg-white p-3 text-xs leading-relaxed text-slate-700"
                                  >
                                    <p className="whitespace-pre-line">
                                      {t.texto}
                                    </p>
                                    {t.proveedor && (
                                      <p className="mt-1.5 text-[10px] font-medium uppercase tracking-wider text-slate-400">
                                        Transcripción: {t.proveedor}
                                      </p>
                                    )}
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="mt-2 text-xs italic text-slate-500">
                                Sin texto transcrito aún.
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Sección 3: Editor de Acta, Acuerdos, Hash SHA-256 y Conformidades */}
                <form
                  onSubmit={handleSaveMinute}
                  className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-2">
                      <FileText className="h-5 w-5 text-brand-700" />
                      <h4 className="text-sm font-bold text-slate-900">
                        Acta Oficial de la Reunión
                      </h4>
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                          MINUTE_STATUS_META[minuteEstado].badgeClass
                        }`}
                      >
                        {MINUTE_STATUS_META[minuteEstado].label}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={handlePrintMinute}
                      disabled={!minuteContent.trim()}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-brand-300 bg-brand-50 px-3.5 py-2 text-xs font-semibold text-brand-900 transition hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Printer className="h-3.5 w-3.5" />
                      Imprimir / Guardar PDF para Libro Legalizado
                    </button>
                  </div>

                  {/* Controles de estado y plazo de observaciones */}
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <div>
                      <label
                        htmlFor="minute-estado"
                        className="block text-xs font-semibold uppercase tracking-wide text-slate-700"
                      >
                        Estado del acta
                      </label>
                      <select
                        id="minute-estado"
                        value={minuteEstado}
                        onChange={(e) =>
                          setMinuteEstado(e.target.value as MinuteStatus)
                        }
                        className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-200"
                      >
                        <option value="borrador">1. Borrador</option>
                        <option value="revision">2. En revisión</option>
                        <option value="aprobada">3. Aprobada</option>
                        <option value="asentada_en_libro">
                          4. Asentada en libro legalizado
                        </option>
                      </select>
                    </div>

                    <div>
                      <label
                        htmlFor="minute-plazo-obs"
                        className="block text-xs font-semibold uppercase tracking-wide text-slate-700"
                      >
                        Plazo de observaciones (opcional)
                      </label>
                      <input
                        id="minute-plazo-obs"
                        type="datetime-local"
                        value={minutePlazoObs}
                        onChange={(e) => setMinutePlazoObs(e.target.value)}
                        className="mt-1.5 w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm text-slate-900 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-200"
                      />
                    </div>
                  </div>

                  {/* Editor de contenido */}
                  <div className="mt-4">
                    <label
                      htmlFor="minute-contenido"
                      className="block text-xs font-semibold uppercase tracking-wide text-slate-700"
                    >
                      Contenido del acta (usa secciones &ldquo;## Temas
                      tratados&rdquo; y &ldquo;## Acuerdos&rdquo;)
                    </label>
                    <textarea
                      id="minute-contenido"
                      rows={12}
                      value={minuteContent}
                      onChange={(e) => setMinuteContent(e.target.value)}
                      placeholder={`## Temas tratados\n- Evaluación de seguridad en la cuadra\n- Mantenimiento de luminarias\n\n## Acuerdos\n- Coordinar patrullaje nocturno con Serenazgo | Responsable: Presidente | Plazo: 30/11/2026`}
                      className="mt-1.5 w-full rounded-xl border border-slate-300 px-3.5 py-2.5 font-mono text-xs leading-relaxed text-slate-900 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-200"
                    />
                  </div>

                  {/* Vista previa estructurada: Temas tratados y Acuerdos */}
                  {(structured.temasTratados.length > 0 ||
                    structured.acuerdos.length > 0) && (
                    <div className="mt-5 grid gap-4 rounded-xl border border-slate-200 bg-slate-50/70 p-4">
                      {structured.temasTratados.length > 0 && (
                        <div>
                          <h5 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-700">
                            <ListChecks className="h-3.5 w-3.5 text-brand-700" />
                            Temas tratados
                          </h5>
                          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-slate-700">
                            {structured.temasTratados.map((tema, i) => (
                              <li key={i}>{tema}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {structured.acuerdos.length > 0 && (
                        <div>
                          <h5 className="text-xs font-bold uppercase tracking-wide text-slate-700">
                            Acuerdos, responsables y plazos
                          </h5>
                          <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200 bg-white">
                            <table className="w-full text-left text-xs">
                              <thead className="bg-slate-100 text-slate-700">
                                <tr>
                                  <th className="px-3 py-2 font-semibold">
                                    Acuerdo
                                  </th>
                                  <th className="px-3 py-2 font-semibold">
                                    Responsable
                                  </th>
                                  <th className="px-3 py-2 font-semibold">
                                    Plazo
                                  </th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-200 text-slate-700">
                                {structured.acuerdos.map((a, i) => (
                                  <tr key={i}>
                                    <td className="px-3 py-2">{a.acuerdo}</td>
                                    <td className="px-3 py-2 font-medium">
                                      {a.responsable || "Directiva"}
                                    </td>
                                    <td className="px-3 py-2">
                                      {a.plazo || "Por definir"}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Hash SHA-256 de integridad */}
                  {minute?.hash_sha256 && (
                    <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs">
                      <Hash className="h-4 w-4 shrink-0 text-brand-700" />
                      <span className="font-semibold text-slate-700">
                        Integridad SHA-256:
                      </span>
                      <code className="break-all font-mono text-[11px] text-slate-800">
                        {minute.hash_sha256}
                      </code>
                    </div>
                  )}

                  <div className="mt-4 flex justify-end">
                    <button
                      type="submit"
                      disabled={savingMinute}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-5 py-2.5 text-xs font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50"
                    >
                      {savingMinute ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          Guardando acta...
                        </>
                      ) : (
                        <>
                          <Save className="h-3.5 w-3.5" />
                          Guardar acta
                        </>
                      )}
                    </button>
                  </div>

                  {/* Doble Confirmación Directiva + Generar PDF y Difundir por WhatsApp */}
                  {minute && (
                    <div className="mt-6 rounded-2xl border border-brand-200 bg-brand-50/40 p-4 sm:p-5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <ShieldCheck className="h-5 w-5 text-brand-700" />
                          <h5 className="text-sm font-bold text-slate-900">
                            Doble Confirmación Directiva (requisito para generar
                            PDF y difundir)
                          </h5>
                        </div>
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                            isDoubleConfirmed
                              ? "bg-emerald-100 text-emerald-800"
                              : "bg-amber-100 text-amber-800"
                          }`}
                        >
                          {isDoubleConfirmed
                            ? "Doble confirmación completa"
                            : "Pendiente de firmas directivas"}
                        </span>
                      </div>

                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        {/* Tarjeta Presidente */}
                        <div className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-4">
                          <div>
                            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                              Presidente
                            </p>
                            {minute.aprobada_presidente_at ? (
                              <div className="mt-1.5 space-y-0.5">
                                <p className="text-xs font-semibold text-emerald-700">
                                  ✅ Confirmado por{" "}
                                  {(minute.aprobada_presidente_por &&
                                    memberNames[
                                      minute.aprobada_presidente_por
                                    ]) ||
                                    "Presidente"}
                                </p>
                                <p className="text-[11px] text-slate-500">
                                  {formatDateTimePE(
                                    minute.aprobada_presidente_at
                                  )}
                                </p>
                              </div>
                            ) : (
                              <p className="mt-1.5 text-xs font-medium text-amber-700">
                                ⏳ Pendiente de confirmación
                              </p>
                            )}
                          </div>

                          {canConfirmPresidente &&
                            !minute.aprobada_presidente_at && (
                              <button
                                type="button"
                                disabled={confirmingRole !== null}
                                onClick={() =>
                                  handleConfirmByRole("presidente")
                                }
                                className="mt-3 inline-flex items-center justify-center gap-1.5 rounded-xl bg-brand-800 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-brand-900 disabled:opacity-50"
                              >
                                {confirmingRole === "presidente" ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <UserCheck className="h-3.5 w-3.5" />
                                )}
                                Confirmar como Presidente
                              </button>
                            )}
                        </div>

                        {/* Tarjeta Secretario/a */}
                        <div className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-4">
                          <div>
                            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                              Secretario/a
                            </p>
                            {minute.aprobada_secretario_at ? (
                              <div className="mt-1.5 space-y-0.5">
                                <p className="text-xs font-semibold text-emerald-700">
                                  ✅ Confirmado por{" "}
                                  {(minute.aprobada_secretario_por &&
                                    memberNames[
                                      minute.aprobada_secretario_por
                                    ]) ||
                                    "Secretario/a"}
                                </p>
                                <p className="text-[11px] text-slate-500">
                                  {formatDateTimePE(
                                    minute.aprobada_secretario_at
                                  )}
                                </p>
                              </div>
                            ) : (
                              <p className="mt-1.5 text-xs font-medium text-amber-700">
                                ⏳ Pendiente de confirmación
                              </p>
                            )}
                          </div>

                          {canConfirmSecretario &&
                            !minute.aprobada_secretario_at && (
                              <button
                                type="button"
                                disabled={confirmingRole !== null}
                                onClick={() =>
                                  handleConfirmByRole("secretario")
                                }
                                className="mt-3 inline-flex items-center justify-center gap-1.5 rounded-xl bg-brand-800 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-brand-900 disabled:opacity-50"
                              >
                                {confirmingRole === "secretario" ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <UserCheck className="h-3.5 w-3.5" />
                                )}
                                Confirmar como Secretario/a
                              </button>
                            )}
                        </div>
                      </div>

                      <p className="mt-3 text-[11px] text-slate-600">
                        <em>
                          Si editas y guardas el texto del acta, ambas
                          confirmaciones se reinician automáticamente para
                          garantizar integridad.
                        </em>
                      </p>

                      {/* Acción principal condicional: Generar PDF y Difundir */}
                      <div className="mt-4 flex flex-wrap items-center gap-2.5 border-t border-brand-200/70 pt-4">
                        <button
                          type="button"
                          onClick={handleGeneratePdf}
                          disabled={!isDoubleConfirmed || generatingPdf}
                          className="inline-flex items-center gap-2 rounded-xl bg-brand-800 px-4 py-2.5 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-900 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {generatingPdf ? (
                            <>
                              <Loader2 className="h-4 w-4 animate-spin" />
                              Generando PDF oficial...
                            </>
                          ) : (
                            <>📄 Generar PDF y Difundir por WhatsApp</>
                          )}
                        </button>

                        {!isDoubleConfirmed && (
                          <span className="text-xs text-amber-800">
                            Requiere confirmación de Presidente y Secretario/a.
                          </span>
                        )}
                      </div>

                      {/* Acciones post-generación (cuando pdfUrl o minute.pdf_path existe) */}
                      {(pdfUrl || minute.pdf_path) && (
                        <div className="mt-4 flex flex-wrap items-center gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50/70 p-3.5">
                          {pdfUrl ? (
                            <a
                              href={pdfUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 rounded-xl border border-brand-300 bg-white px-3.5 py-2 text-xs font-semibold text-brand-900 shadow-sm transition hover:bg-brand-50"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                              Descargar / Ver PDF oficial
                            </a>
                          ) : (
                            <button
                              type="button"
                              onClick={handleGeneratePdf}
                              disabled={!isDoubleConfirmed || generatingPdf}
                              className="inline-flex items-center gap-1.5 rounded-xl border border-brand-300 bg-white px-3.5 py-2 text-xs font-semibold text-brand-900 shadow-sm transition hover:bg-brand-50 disabled:opacity-50"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                              Descargar / Ver PDF oficial
                            </button>
                          )}

                          <a
                            href={whatsappShareUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-emerald-700"
                          >
                            <MessageCircle className="h-3.5 w-3.5" />
                            📲 Difundir al grupo de WhatsApp
                          </a>

                          <button
                            type="button"
                            onClick={handleCopyWhatsAppMessage}
                            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                          >
                            {copiedWa ? (
                              <>
                                <Check className="h-3.5 w-3.5 text-emerald-600" />
                                Mensaje copiado
                              </>
                            ) : (
                              <>
                                <Copy className="h-3.5 w-3.5" />
                                Copiar mensaje para WhatsApp
                              </>
                            )}
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Cuadro de conformidades digitales y acuses de recibido */}
                  <div className="mt-6 border-t border-slate-200 pt-5">
                    <div className="flex items-center gap-2">
                      <FileCheck2 className="h-4 w-4 text-brand-700" />
                      <h5 className="text-sm font-bold text-slate-900">
                        Conformidades Digitales y Acuses de Recibido (
                        {signatures.length})
                      </h5>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      Respaldo interno de conocimiento y conformidad vecinal
                      para asentar en el libro de actas legalizado.
                    </p>

                    {signatures.length === 0 ? (
                      <p className="mt-3 text-xs text-slate-500">
                        Aún no se registran conformidades ni acuses de recibido
                        para esta acta.
                      </p>
                    ) : (
                      <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200">
                        <table className="w-full text-left text-xs">
                          <thead className="bg-slate-50 text-slate-700">
                            <tr>
                              <th className="px-3.5 py-2 font-semibold">
                                Vecino
                              </th>
                              <th className="px-3.5 py-2 font-semibold">
                                Tipo de registro
                              </th>
                              <th className="px-3.5 py-2 font-semibold">
                                Fecha y hora (Perú)
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200 text-slate-700">
                            {signatures.map((sig) => (
                              <tr key={sig.id}>
                                <td className="px-3.5 py-2 font-medium text-slate-900">
                                  {memberNames[sig.user_id] ??
                                    "Vecino registrado"}
                                </td>
                                <td className="px-3.5 py-2">
                                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-800">
                                    <ShieldCheck className="h-3 w-3" />
                                    {SIGNATURE_TYPE_LABELS[sig.tipo]}
                                  </span>
                                </td>
                                <td className="px-3.5 py-2">
                                  {formatDateTimePE(sig.firmado_at)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </form>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ===================================================================== */}
      {/* VISTA LIMPIA OPTIMIZADA PARA IMPRESIÓN / PDF (LIBRO LEGALIZADO)       */}
      {/* ===================================================================== */}
      {selectedMeeting && (
        <div className="print-only hidden bg-white text-slate-900">
          <div className="border-b-2 border-slate-900 pb-4 text-center">
            <p className="text-xs font-bold uppercase tracking-widest text-slate-600">
              {groupName || "Asociación Bello Horizonte"} — Perú
            </p>
            <h1 className="mt-1 text-2xl font-extrabold uppercase tracking-tight text-slate-900">
              Acta de Reunión Vecinal
            </h1>
            <p className="mt-1 text-xs text-slate-600">
              Documento oficial de respaldo para asiento en Libro de Actas
              Legalizado
            </p>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3 rounded border border-slate-300 p-4 text-xs">
            <div>
              <span className="font-bold uppercase text-slate-600">
                Reunión:
              </span>{" "}
              <span className="font-semibold">{selectedMeeting.titulo}</span>
            </div>
            <div>
              <span className="font-bold uppercase text-slate-600">
                Fecha y hora:
              </span>{" "}
              <span>{formatDateTimePE(selectedMeeting.fecha)}</span>
            </div>
            <div>
              <span className="font-bold uppercase text-slate-600">Lugar:</span>{" "}
              <span>{selectedMeeting.lugar || "No especificado"}</span>
            </div>
            <div>
              <span className="font-bold uppercase text-slate-600">
                Estado del acta:
              </span>{" "}
              <span>{MINUTE_STATUS_META[minuteEstado].label}</span>
            </div>
            <div className="col-span-2">
              <span className="font-bold uppercase text-slate-600">
                Asistentes presentes ({attendanceCounts.asistio}):
              </span>{" "}
              <span>
                {attendance
                  .filter((a) => a.asistio)
                  .map((a) => memberNames[a.user_id] ?? "Vecino")
                  .join(", ") || "Según relación adjunta"}
              </span>
            </div>
          </div>

          <section className="mt-6">
            <h2 className="border-b border-slate-300 pb-1 text-sm font-bold uppercase tracking-wide text-slate-900">
              Contenido del Acta
            </h2>
            <div className="mt-3 whitespace-pre-line text-xs leading-relaxed text-slate-800">
              {minuteContent || "Sin contenido registrado."}
            </div>
          </section>

          {structured.acuerdos.length > 0 && (
            <section className="mt-6">
              <h2 className="border-b border-slate-300 pb-1 text-sm font-bold uppercase tracking-wide text-slate-900">
                Cuadro Resumen de Acuerdos, Responsables y Plazos
              </h2>
              <table className="mt-3 w-full border-collapse border border-slate-400 text-left text-xs">
                <thead>
                  <tr className="bg-slate-100">
                    <th className="border border-slate-400 px-2.5 py-1.5 font-bold">
                      Acuerdo
                    </th>
                    <th className="border border-slate-400 px-2.5 py-1.5 font-bold">
                      Responsable
                    </th>
                    <th className="border border-slate-400 px-2.5 py-1.5 font-bold">
                      Plazo
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {structured.acuerdos.map((a, idx) => (
                    <tr key={idx}>
                      <td className="border border-slate-400 px-2.5 py-1.5">
                        {a.acuerdo}
                      </td>
                      <td className="border border-slate-400 px-2.5 py-1.5">
                        {a.responsable || "Directiva"}
                      </td>
                      <td className="border border-slate-400 px-2.5 py-1.5">
                        {a.plazo || "Por definir"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          <section className="mt-6">
            <h2 className="border-b border-slate-300 pb-1 text-sm font-bold uppercase tracking-wide text-slate-900">
              Cuadro de Conformidades Digitales y Acuses de Recibido
            </h2>
            {signatures.length === 0 ? (
              <p className="mt-2 text-xs text-slate-600">
                Sin conformidades digitales registradas a la fecha de impresión.
              </p>
            ) : (
              <table className="mt-3 w-full border-collapse border border-slate-400 text-left text-xs">
                <thead>
                  <tr className="bg-slate-100">
                    <th className="border border-slate-400 px-2.5 py-1.5 font-bold">
                      Socio / Vecino
                    </th>
                    <th className="border border-slate-400 px-2.5 py-1.5 font-bold">
                      Tipo de conformidad
                    </th>
                    <th className="border border-slate-400 px-2.5 py-1.5 font-bold">
                      Fecha y hora (Perú)
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {signatures.map((sig) => (
                    <tr key={sig.id}>
                      <td className="border border-slate-400 px-2.5 py-1.5">
                        {memberNames[sig.user_id] ?? "Vecino registrado"}
                      </td>
                      <td className="border border-slate-400 px-2.5 py-1.5">
                        {SIGNATURE_TYPE_LABELS[sig.tipo]}
                      </td>
                      <td className="border border-slate-400 px-2.5 py-1.5">
                        {formatDateTimePE(sig.firmado_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <div className="mt-8 border-t border-slate-400 pt-3 text-[11px] text-slate-700">
            <p>
              <strong>Hash de integridad (SHA-256):</strong>{" "}
              <code className="break-all font-mono">
                {minute?.hash_sha256 || "Pendiente de guardar acta"}
              </code>
            </p>
            <p className="mt-1 text-slate-500">
              Respaldo digital generado desde el Portal de Asociación Bello
              Horizonte. Las conformidades digitales constituyen constancia
              interna de conocimiento y aprobación previa al asiento físico en
              el Libro de Actas legalizado.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
