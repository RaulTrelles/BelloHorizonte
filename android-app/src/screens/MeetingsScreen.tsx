import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  canManageMeetings,
  confirmMinuteByRole,
  createMeeting,
  generateMeetingMinute,
  generateOfficialMinutePdf,
  getGroupMeetings,
  getMeetingDetails,
  getPublicMinutePdfUrl,
  isMinuteFullyApproved,
  purgeMeetingAudio,
  setMyMeetingAttendance,
  signMinute,
  updateMeetingStatus,
  updateMinuteContentAndStatus,
} from '../services/belloHorizonteApi';
import type {
  AttendanceResponse,
  MeetingDetailsBundle,
  MeetingRecord,
  MembershipWithGroup,
  MinuteStatus,
  OfficialMinutePdfResult,
  RecordingStatus,
} from '../types/database';

interface MeetingsScreenProps {
  membership: MembershipWithGroup;
  currentUserId: string;
  initialMeetingId?: string | null;
  onClearInitialMeetingId?: () => void;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return iso;
  }
  return d.toLocaleString('es-PE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function meetingStatusLabel(status: MeetingRecord['estado']): string {
  switch (status) {
    case 'en_curso':
      return 'EN CURSO';
    case 'finalizada':
      return 'FINALIZADA';
    case 'cancelada':
      return 'CANCELADA';
    default:
      return 'PROGRAMADA';
  }
}

function minuteStatusLabel(status: MinuteStatus): string {
  switch (status) {
    case 'borrador':
      return 'BORRADOR';
    case 'revision':
      return 'EN REVISIÓN';
    case 'aprobada':
      return 'APROBADA';
    case 'asentada_en_libro':
      return 'ASENTADA EN LIBRO';
  }
}

function recordingStatusLabel(status: RecordingStatus): string {
  switch (status) {
    case 'grabando':
      return 'Grabando';
    case 'subido':
      return 'Subido';
    case 'transcribiendo':
      return 'Transcribiendo';
    case 'transcrito':
      return 'Transcrito';
    case 'error':
      return 'Error';
    case 'eliminado':
      return 'Eliminado (Ley 29733)';
  }
}

export function MeetingsScreen({
  membership,
  currentUserId,
  initialMeetingId,
  onClearInitialMeetingId,
}: MeetingsScreenProps): React.JSX.Element {
  const isBoard = canManageMeetings(membership.rol);

  const [meetings, setMeetings] = useState<MeetingRecord[]>([]);
  const [loadingList, setLoadingList] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Detalle de reunión seleccionada
  const [selectedMeetingId, setSelectedMeetingId] = useState<string | null>(
    initialMeetingId ?? null
  );
  const [details, setDetails] = useState<MeetingDetailsBundle | null>(null);
  const [loadingDetails, setLoadingDetails] = useState<boolean>(false);
  const [busyAction, setBusyAction] = useState<boolean>(false);

  // Edición de acta (solo directiva)
  const [editingMinute, setEditingMinute] = useState<boolean>(false);
  const [minuteDraftText, setMinuteDraftText] = useState<string>('');
  const [latestPdfResult, setLatestPdfResult] = useState<OfficialMinutePdfResult | null>(null);

  // Modal crear reunión (solo directiva)
  const [createModalVisible, setCreateModalVisible] = useState<boolean>(false);
  const [newTitle, setNewTitle] = useState<string>('');
  const [newPlace, setNewPlace] = useState<string>('Local Comunal / Parque Bello Horizonte');
  const [newAgenda, setNewAgenda] = useState<string>('');

  const loadMeetings = useCallback(
    async (isPull = false) => {
      if (isPull) {
        setRefreshing(true);
      } else {
        setLoadingList(true);
      }
      setErrorMsg(null);
      try {
        const list = await getGroupMeetings(membership.group_id, 30);
        setMeetings(list);
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : 'No se pudieron cargar las reuniones.');
      } finally {
        setLoadingList(false);
        setRefreshing(false);
      }
    },
    [membership.group_id]
  );

  const loadDetails = useCallback(
    async (meetingId: string) => {
      setLoadingDetails(true);
      setErrorMsg(null);
      try {
        const bundle = await getMeetingDetails(meetingId, membership.group_id);
        setDetails(bundle);
        setMinuteDraftText(bundle.minute?.contenido ?? '');
      } catch (err) {
        setErrorMsg(
          err instanceof Error ? err.message : 'No se pudo cargar el detalle de la reunión.'
        );
      } finally {
        setLoadingDetails(false);
      }
    },
    [membership.group_id]
  );

  useEffect(() => {
    loadMeetings();
  }, [loadMeetings]);

  useEffect(() => {
    if (initialMeetingId) {
      setSelectedMeetingId(initialMeetingId);
      onClearInitialMeetingId?.();
    }
  }, [initialMeetingId, onClearInitialMeetingId]);

  useEffect(() => {
    if (selectedMeetingId) {
      setLatestPdfResult(null);
      loadDetails(selectedMeetingId);
    } else {
      setDetails(null);
      setEditingMinute(false);
      setLatestPdfResult(null);
    }
  }, [loadDetails, selectedMeetingId]);

  const handleCreateMeeting = async (): Promise<void> => {
    if (!newTitle.trim()) {
      Alert.alert('Título requerido', 'Ingresa un título para la reunión.');
      return;
    }
    setBusyAction(true);
    try {
      const created = await createMeeting({
        groupId: membership.group_id,
        userId: currentUserId,
        titulo: newTitle,
        lugar: newPlace,
        agenda: newAgenda,
        estado: 'programada',
      });
      setCreateModalVisible(false);
      setNewTitle('');
      setNewAgenda('');
      await loadMeetings(true);
      setSelectedMeetingId(created.id);
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'No se pudo crear la reunión.');
    } finally {
      setBusyAction(false);
    }
  };

  const handleAttendance = async (respuesta: AttendanceResponse): Promise<void> => {
    if (!details) {
      return;
    }
    setBusyAction(true);
    try {
      await setMyMeetingAttendance(details.meeting.id, currentUserId, respuesta);
      await loadDetails(details.meeting.id);
    } catch (err) {
      Alert.alert(
        'Error',
        err instanceof Error ? err.message : 'No se pudo registrar tu asistencia.'
      );
    } finally {
      setBusyAction(false);
    }
  };

  const handleGenerateMinute = async (): Promise<void> => {
    if (!details) {
      return;
    }
    setBusyAction(true);
    try {
      await generateMeetingMinute(details.meeting.id);
      if (details.meeting.estado === 'en_curso') {
        await updateMeetingStatus(details.meeting.id, 'finalizada').catch(() => {});
      }
      await loadDetails(details.meeting.id);
      Alert.alert('Borrador generado', 'El borrador de acta ya está disponible para revisión.');
    } catch (err) {
      Alert.alert(
        'Error generando acta',
        err instanceof Error ? err.message : 'No se pudo generar el borrador de acta.'
      );
    } finally {
      setBusyAction(false);
    }
  };

  const handleSaveMinute = async (nextStatus?: MinuteStatus): Promise<void> => {
    if (!details?.minute) {
      return;
    }
    setBusyAction(true);
    try {
      await updateMinuteContentAndStatus(details.minute.id, {
        contenido: minuteDraftText,
        estado: nextStatus ?? details.minute.estado,
        aprobadaPor:
          nextStatus === 'aprobada' || nextStatus === 'asentada_en_libro'
            ? currentUserId
            : undefined,
      });
      setEditingMinute(false);
      setLatestPdfResult(null);
      await loadDetails(details.meeting.id);
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'No se pudo actualizar el acta.');
    } finally {
      setBusyAction(false);
    }
  };

  const handlePurgeAudio = (): void => {
    if (!details) {
      return;
    }
    Alert.alert(
      'Eliminar audios (Ley 29733)',
      'Se eliminarán permanentemente los archivos de audio de esta reunión en Supabase Storage, conservando el acta escrita.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar audios',
          style: 'destructive',
          onPress: async () => {
            setBusyAction(true);
            try {
              await purgeMeetingAudio(details.meeting.id);
              await loadDetails(details.meeting.id);
              Alert.alert('Audios eliminados', 'Se aplicó retención mínima (Ley 29733).');
            } catch (err) {
              Alert.alert(
                'Error',
                err instanceof Error ? err.message : 'No se pudieron eliminar los audios.'
              );
            } finally {
              setBusyAction(false);
            }
          },
        },
      ]
    );
  };

  const handleConfirmMinuteByRole = async (
    asRole: 'presidente' | 'secretario'
  ): Promise<void> => {
    if (!details?.minute) {
      return;
    }
    setBusyAction(true);
    try {
      await confirmMinuteByRole(details.minute.id, asRole);
      await loadDetails(details.meeting.id);
      Alert.alert(
        'Confirmación registrada',
        asRole === 'presidente'
          ? 'Se registró la confirmación directiva del Presidente.'
          : 'Se registró la confirmación directiva de Secretaría.'
      );
    } catch (err) {
      Alert.alert(
        'Error',
        err instanceof Error ? err.message : 'No se pudo registrar la confirmación.'
      );
    } finally {
      setBusyAction(false);
    }
  };

  const handleOpenExternalUrl = async (url: string, fallbackMessage: string): Promise<void> => {
    if (!/^https?:\/\//i.test(url.trim())) {
      Alert.alert('Enlace no disponible', fallbackMessage);
      return;
    }
    try {
      await Linking.openURL(url.trim());
    } catch {
      Alert.alert('Error', fallbackMessage);
    }
  };

  const handleGeneratePdfAndShare = async (): Promise<void> => {
    if (!details?.minute || !isMinuteFullyApproved(details.minute)) {
      return;
    }
    setBusyAction(true);
    try {
      const result = await generateOfficialMinutePdf(details.meeting.id);
      setLatestPdfResult(result);
      await loadDetails(details.meeting.id);
      if (result.whatsappShareUrl) {
        await handleOpenExternalUrl(
          result.whatsappShareUrl,
          'El PDF se generó correctamente, pero no se pudo abrir WhatsApp automáticamente.'
        );
      }
    } catch (err) {
      Alert.alert(
        'Error generando PDF oficial',
        err instanceof Error ? err.message : 'No se pudo generar el PDF oficial del acta.'
      );
    } finally {
      setBusyAction(false);
    }
  };

  const handleSignMinute = async (
    tipo: 'acuse_recibo' | 'conformidad_simple'
  ): Promise<void> => {
    if (!details?.minute) {
      return;
    }
    setBusyAction(true);
    try {
      await signMinute({
        minuteId: details.minute.id,
        userId: currentUserId,
        tipo,
      });
      await loadDetails(details.meeting.id);
      Alert.alert(
        'Constancia registrada',
        tipo === 'acuse_recibo'
          ? 'Tu acuse de recibido quedó registrado.'
          : 'Tu conformidad digital quedó registrada para el libro de actas.'
      );
    } catch (err) {
      Alert.alert(
        'Error',
        err instanceof Error ? err.message : 'No se pudo registrar tu firma/conformidad.'
      );
    } finally {
      setBusyAction(false);
    }
  };

  // Vista Detalle de Reunión
  if (selectedMeetingId) {
    const myAttendance = details?.attendance.find((a) => a.user_id === currentUserId);
    const attendeesYes = details?.attendance.filter((a) => a.respuesta === 'asistire') ?? [];
    const minute = details?.minute ?? null;
    const myAcuse = details?.signatures.some(
      (s) => s.user_id === currentUserId && s.tipo === 'acuse_recibo'
    );
    const myConformidad = details?.signatures.some(
      (s) => s.user_id === currentUserId && s.tipo === 'conformidad_simple'
    );

    return (
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.rowBetween}>
          <Pressable style={styles.backBtn} onPress={() => setSelectedMeetingId(null)}>
            <Text style={styles.backBtnText}>← Todas las reuniones</Text>
          </Pressable>
          <Pressable style={styles.refreshBtn} onPress={() => loadDetails(selectedMeetingId)}>
            <Text style={styles.refreshBtnText}>Actualizar</Text>
          </Pressable>
        </View>

        {loadingDetails || !details ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color="#DC2626" />
          </View>
        ) : (
          <>
            <View style={styles.card}>
              <View style={styles.rowBetween}>
                <View style={styles.statusPill}>
                  <Text style={styles.statusPillText}>
                    {meetingStatusLabel(details.meeting.estado)}
                  </Text>
                </View>
                <Text style={styles.metaText}>{formatDateTime(details.meeting.fecha)}</Text>
              </View>
              <Text style={styles.detailTitle}>{details.meeting.titulo}</Text>
              {details.meeting.lugar && (
                <Text style={styles.metaText}>📍 {details.meeting.lugar}</Text>
              )}
              {details.meeting.agenda && (
                <Text style={styles.bodyText}>Agenda: {details.meeting.agenda}</Text>
              )}
            </View>

            {/* Asistencia (todos los miembros activos) */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>
                Asistencia ({attendeesYes.length} confirmados)
              </Text>
              <View style={styles.rowGap}>
                <Pressable
                  style={[
                    styles.attendBtn,
                    myAttendance?.respuesta === 'asistire' && styles.attendBtnYesActive,
                  ]}
                  disabled={busyAction}
                  onPress={() => handleAttendance('asistire')}
                >
                  <Text
                    style={[
                      styles.attendBtnText,
                      myAttendance?.respuesta === 'asistire' && styles.attendBtnTextLight,
                    ]}
                  >
                    ✓ Asistiré
                  </Text>
                </Pressable>
                <Pressable
                  style={[
                    styles.attendBtn,
                    myAttendance?.respuesta === 'no_asistire' && styles.attendBtnNoActive,
                  ]}
                  disabled={busyAction}
                  onPress={() => handleAttendance('no_asistire')}
                >
                  <Text
                    style={[
                      styles.attendBtnText,
                      myAttendance?.respuesta === 'no_asistire' && styles.attendBtnTextLight,
                    ]}
                  >
                    ✕ No asistiré
                  </Text>
                </Pressable>
              </View>
              {attendeesYes.length > 0 && (
                <Text style={styles.metaText}>
                  Confirmados: {attendeesYes.map((a) => a.userName).join(', ')}
                </Text>
              )}
            </View>

            {/* Bloques grabados y controles de Directiva */}
            {isBoard && (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Grabación y Borrador IA (Directiva)</Text>
                <Text style={styles.metaText}>
                  Bloques grabados: {details.recordings.length} · Transcritos:{' '}
                  {details.transcripts.length}
                </Text>
                {details.recordings.length > 0 && (
                  <View style={styles.stackGap}>
                    {details.recordings.map((rec, idx) => (
                      <Text key={rec.id} style={styles.metaText}>
                        • Bloque #{rec.chunk_index ?? idx + 1}: {recordingStatusLabel(rec.estado)}
                      </Text>
                    ))}
                  </View>
                )}
                <View style={styles.stackGap}>
                  <Pressable
                    style={[styles.primaryBtn, busyAction && styles.disabled]}
                    disabled={busyAction}
                    onPress={handleGenerateMinute}
                  >
                    <Text style={styles.primaryBtnText}>
                      {minute ? 'Regenerar borrador de acta' : 'Generar borrador de acta'}
                    </Text>
                  </Pressable>
                  {details.recordings.some((r) => r.estado !== 'eliminado') && (
                    <Pressable
                      style={[styles.dangerOutlineBtn, busyAction && styles.disabled]}
                      disabled={busyAction}
                      onPress={handlePurgeAudio}
                    >
                      <Text style={styles.dangerOutlineText}>
                        Eliminar audios (Ley 29733)
                      </Text>
                    </Pressable>
                  )}
                </View>
              </View>
            )}

            {/* Acta de Reunión */}
            <View style={styles.card}>
              <View style={styles.rowBetween}>
                <Text style={styles.cardTitle}>Acta de la Reunión</Text>
                {minute && (
                  <View style={styles.minuteBadge}>
                    <Text style={styles.minuteBadgeText}>{minuteStatusLabel(minute.estado)}</Text>
                  </View>
                )}
              </View>

              {!minute ? (
                <Text style={styles.metaText}>
                  Aún no hay un acta generada para esta reunión.
                </Text>
              ) : (
                <>
                  {editingMinute && isBoard ? (
                    <>
                      <TextInput
                        style={styles.minuteEditor}
                        multiline
                        value={minuteDraftText}
                        onChangeText={setMinuteDraftText}
                        textAlignVertical="top"
                      />
                      <View style={styles.rowGap}>
                        <Pressable
                          style={styles.primaryBtnFlex}
                          disabled={busyAction}
                          onPress={() => handleSaveMinute()}
                        >
                          <Text style={styles.primaryBtnText}>Guardar texto</Text>
                        </Pressable>
                        <Pressable
                          style={styles.secondaryBtnFlex}
                          onPress={() => {
                            setMinuteDraftText(minute.contenido);
                            setEditingMinute(false);
                          }}
                        >
                          <Text style={styles.secondaryBtnText}>Cancelar</Text>
                        </Pressable>
                      </View>
                    </>
                  ) : (
                    <Text selectable style={styles.minuteContent}>
                      {minute.contenido}
                    </Text>
                  )}

                  {minute.hash_sha256 && (
                    <View style={styles.hashBox}>
                      <Text style={styles.hashLabel}>SHA-256 (integridad del acta):</Text>
                      <Text selectable style={styles.hashValue}>
                        {minute.hash_sha256}
                      </Text>
                    </View>
                  )}

                  {isBoard && !editingMinute && (
                    <View style={styles.stackGap}>
                      {/* Doble Confirmación Directiva (Presidente + Secretaría) */}
                      <View style={styles.dualApprovalBox}>
                        <Text style={styles.subTitle}>Doble Confirmación Directiva</Text>
                        <Text style={styles.metaText}>
                          • Presidente:{' '}
                          {minute.aprobada_presidente_at
                            ? `✅ Confirmado por ${
                                details.presidentApproverName || 'Presidente'
                              } (${formatDateTime(minute.aprobada_presidente_at)})`
                            : '⏳ Pendiente de confirmación'}
                        </Text>
                        <Text style={styles.metaText}>
                          • Secretaría:{' '}
                          {minute.aprobada_secretario_at
                            ? `✅ Confirmado por ${
                                details.secretaryApproverName || 'Secretaría'
                              } (${formatDateTime(minute.aprobada_secretario_at)})`
                            : '⏳ Pendiente de confirmación'}
                        </Text>
                        <Text style={styles.warningNote}>
                          Nota: Editar el texto del acta reinicia ambas confirmaciones directivas.
                        </Text>

                        <View style={styles.rowGap}>
                          {(membership.rol === 'presidente' || membership.rol === 'admin') &&
                            !minute.aprobada_presidente_at && (
                              <Pressable
                                style={[styles.approveBtnFlex, busyAction && styles.disabled]}
                                disabled={busyAction}
                                onPress={() => handleConfirmMinuteByRole('presidente')}
                              >
                                <Text style={styles.primaryBtnText}>
                                  Confirmar como Presidente
                                </Text>
                              </Pressable>
                            )}
                          {(membership.rol === 'secretario' || membership.rol === 'admin') &&
                            !minute.aprobada_secretario_at && (
                              <Pressable
                                style={[styles.primaryBtnFlex, busyAction && styles.disabled]}
                                disabled={busyAction}
                                onPress={() => handleConfirmMinuteByRole('secretario')}
                              >
                                <Text style={styles.primaryBtnText}>
                                  Confirmar como Secretario/a
                                </Text>
                              </Pressable>
                            )}
                        </View>
                      </View>

                      {/* Generar PDF oficial y difundir por WhatsApp (solo si ambos confirmaron) */}
                      <Pressable
                        style={[
                          styles.whatsappPdfBtn,
                          (!isMinuteFullyApproved(minute) || busyAction) && styles.disabled,
                        ]}
                        disabled={!isMinuteFullyApproved(minute) || busyAction}
                        onPress={handleGeneratePdfAndShare}
                      >
                        <Text style={styles.primaryBtnText}>
                          📄 Generar PDF y difundir por WhatsApp
                        </Text>
                      </Pressable>

                      {(latestPdfResult?.pdfUrl || minute.pdf_path) && (
                        <Pressable
                          style={styles.secondaryBtn}
                          onPress={() => {
                            const url =
                              latestPdfResult?.pdfUrl ||
                              (minute.pdf_path ? getPublicMinutePdfUrl(minute.pdf_path) : '');
                            handleOpenExternalUrl(
                              url,
                              'No se pudo abrir el archivo PDF oficial del acta.'
                            ).catch(() => {});
                          }}
                        >
                          <Text style={styles.secondaryBtnText}>Abrir PDF oficial</Text>
                        </Pressable>
                      )}

                      <Pressable
                        style={styles.secondaryBtn}
                        disabled={busyAction}
                        onPress={() => setEditingMinute(true)}
                      >
                        <Text style={styles.secondaryBtnText}>Editar borrador de acta</Text>
                      </Pressable>

                      <Pressable
                        style={styles.darkBtn}
                        disabled={busyAction}
                        onPress={() => handleSaveMinute('asentada_en_libro')}
                      >
                        <Text style={styles.primaryBtnText}>Marcar asentada en libro</Text>
                      </Pressable>
                    </View>
                  )}

                  {!isBoard && minute.pdf_path && (
                    <Pressable
                      style={styles.secondaryBtn}
                      onPress={() => {
                        const url = getPublicMinutePdfUrl(minute.pdf_path!);
                        handleOpenExternalUrl(
                          url,
                          'No se pudo abrir el archivo PDF oficial del acta.'
                        ).catch(() => {});
                      }}
                    >
                      <Text style={styles.secondaryBtnText}>📄 Abrir PDF oficial</Text>
                    </Pressable>
                  )}

                  {/* Acuse de recibido y Conformidad digital (solo cuando el acta está aprobada o asentada) */}
                  <View style={styles.signaturesBox}>
                    <Text style={styles.subTitle}>
                      Conformidades digitales ({details.signatures.length})
                    </Text>
                    {minute.estado === 'aprobada' || minute.estado === 'asentada_en_libro' ? (
                      <View style={styles.rowGap}>
                        <Pressable
                          style={[
                            styles.signBtn,
                            myAcuse && styles.signBtnDone,
                          ]}
                          disabled={busyAction || myAcuse}
                          onPress={() => handleSignMinute('acuse_recibo')}
                        >
                          <Text style={[styles.signBtnText, myAcuse && styles.signBtnTextDone]}>
                            {myAcuse ? '✓ Recibido' : 'Acuse de recibido'}
                          </Text>
                        </Pressable>
                        <Pressable
                          style={[
                            styles.signBtn,
                            myConformidad && styles.signBtnDone,
                          ]}
                          disabled={busyAction || myConformidad}
                          onPress={() => handleSignMinute('conformidad_simple')}
                        >
                          <Text
                            style={[styles.signBtnText, myConformidad && styles.signBtnTextDone]}
                          >
                            {myConformidad ? '✓ Conforme' : 'Dar conformidad'}
                          </Text>
                        </Pressable>
                      </View>
                    ) : (
                      <Text style={styles.metaText}>
                        Los botones de Acuse de recibido y Conformidad se habilitarán cuando la
                        directiva apruebe el acta.
                      </Text>
                    )}
                    {details.signatures.map((sig) => (
                      <Text key={sig.id} style={styles.metaText}>
                        • {sig.userName} —{' '}
                        {sig.tipo === 'acuse_recibo' ? 'Acuse de recibido' : 'Conformidad simple'} (
                        {formatDateTime(sig.firmado_at)})
                      </Text>
                    ))}
                  </View>
                </>
              )}
            </View>
          </>
        )}
      </ScrollView>
    );
  }

  // Vista Lista de Reuniones
  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => loadMeetings(true)} />
      }
    >
      <View style={styles.rowBetween}>
        <View>
          <Text style={styles.title}>Reuniones y Actas</Text>
          <Text style={styles.subtitle}>{membership.group.nombre}</Text>
        </View>
        {isBoard && (
          <Pressable style={styles.newMeetingBtn} onPress={() => setCreateModalVisible(true)}>
            <Text style={styles.newMeetingBtnText}>+ Nueva</Text>
          </Pressable>
        )}
      </View>

      {errorMsg && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{errorMsg}</Text>
        </View>
      )}

      {loadingList ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#DC2626" />
        </View>
      ) : meetings.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>Sin reuniones programadas</Text>
          <Text style={styles.emptyText}>
            Cuando la directiva convoque una reunión o grabe una asamblea, aparecerá aquí con su
            acta y conformidades.
          </Text>
        </View>
      ) : (
        meetings.map((meeting) => (
          <Pressable
            key={meeting.id}
            style={styles.card}
            onPress={() => setSelectedMeetingId(meeting.id)}
          >
            <View style={styles.rowBetween}>
              <View style={styles.statusPill}>
                <Text style={styles.statusPillText}>{meetingStatusLabel(meeting.estado)}</Text>
              </View>
              <Text style={styles.metaText}>{formatDateTime(meeting.fecha)}</Text>
            </View>
            <Text style={styles.meetingTitle}>{meeting.titulo}</Text>
            {meeting.lugar && <Text style={styles.metaText}>📍 {meeting.lugar}</Text>}
            <Text style={styles.openLink}>Ver asistencia y acta →</Text>
          </Pressable>
        ))
      )}

      {/* Modal crear nueva reunión */}
      <Modal
        visible={createModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setCreateModalVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Nueva Reunión Vecinal</Text>
            <Text style={styles.label}>Título</Text>
            <TextInput
              style={styles.input}
              value={newTitle}
              onChangeText={setNewTitle}
              placeholder="Ej. Asamblea General — Noviembre"
            />
            <Text style={styles.label}>Lugar</Text>
            <TextInput
              style={styles.input}
              value={newPlace}
              onChangeText={setNewPlace}
              placeholder="Local comunal / parque"
            />
            <Text style={styles.label}>Agenda (opcional)</Text>
            <TextInput
              style={[styles.input, styles.multilineInput]}
              multiline
              value={newAgenda}
              onChangeText={setNewAgenda}
              placeholder="1. Seguridad ciudadana&#10;2. Cuotas y mantenimiento"
            />
            <View style={styles.rowGap}>
              <Pressable
                style={styles.primaryBtnFlex}
                disabled={busyAction}
                onPress={handleCreateMeeting}
              >
                <Text style={styles.primaryBtnText}>Crear reunión</Text>
              </Pressable>
              <Pressable
                style={styles.secondaryBtnFlex}
                onPress={() => setCreateModalVisible(false)}
              >
                <Text style={styles.secondaryBtnText}>Cancelar</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    gap: 12,
    paddingBottom: 28,
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  rowGap: {
    flexDirection: 'row',
    gap: 8,
  },
  stackGap: {
    gap: 8,
  },
  title: {
    fontSize: 22,
    fontWeight: '900',
    color: '#111827',
  },
  subtitle: {
    fontSize: 12,
    color: '#6B7280',
  },
  newMeetingBtn: {
    backgroundColor: '#1D4ED8',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 10,
  },
  newMeetingBtnText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 13,
  },
  backBtn: {
    backgroundColor: '#E5E7EB',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  backBtnText: {
    color: '#111827',
    fontWeight: '800',
    fontSize: 12,
  },
  refreshBtn: {
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  refreshBtnText: {
    color: '#1D4ED8',
    fontWeight: '700',
    fontSize: 12,
  },
  centered: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  errorBox: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FCA5A5',
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
  },
  errorText: {
    color: '#991B1B',
    fontSize: 13,
    fontWeight: '700',
  },
  emptyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#111827',
  },
  emptyText: {
    fontSize: 13,
    color: '#6B7280',
    textAlign: 'center',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 15,
    gap: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#111827',
  },
  statusPill: {
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  statusPillText: {
    color: '#1D4ED8',
    fontSize: 11,
    fontWeight: '900',
  },
  minuteBadge: {
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  minuteBadgeText: {
    color: '#166534',
    fontSize: 11,
    fontWeight: '900',
  },
  meetingTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#111827',
  },
  detailTitle: {
    fontSize: 19,
    fontWeight: '900',
    color: '#111827',
  },
  metaText: {
    fontSize: 12,
    color: '#4B5563',
  },
  bodyText: {
    fontSize: 13,
    color: '#374151',
    lineHeight: 19,
  },
  openLink: {
    color: '#2563EB',
    fontSize: 13,
    fontWeight: '700',
  },
  attendBtn: {
    flex: 1,
    backgroundColor: '#F3F4F6',
    borderColor: '#D1D5DB',
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
  },
  attendBtnYesActive: {
    backgroundColor: '#16A34A',
    borderColor: '#16A34A',
  },
  attendBtnNoActive: {
    backgroundColor: '#DC2626',
    borderColor: '#DC2626',
  },
  attendBtnText: {
    fontWeight: '800',
    fontSize: 13,
    color: '#1F2937',
  },
  attendBtnTextLight: {
    color: '#FFFFFF',
  },
  primaryBtn: {
    backgroundColor: '#1D4ED8',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  primaryBtnFlex: {
    flex: 1,
    backgroundColor: '#1D4ED8',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  approveBtnFlex: {
    flex: 1,
    backgroundColor: '#16A34A',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  darkBtn: {
    backgroundColor: '#111827',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  whatsappPdfBtn: {
    backgroundColor: '#15803D',
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
  },
  dualApprovalBox: {
    backgroundColor: '#F9FAFB',
    borderColor: '#D1D5DB',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 6,
  },
  warningNote: {
    fontSize: 11,
    color: '#92400E',
    fontWeight: '600',
    marginTop: 2,
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 13,
  },
  secondaryBtn: {
    backgroundColor: '#E5E7EB',
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
  },
  secondaryBtnFlex: {
    flex: 1,
    backgroundColor: '#E5E7EB',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  secondaryBtnText: {
    color: '#1F2937',
    fontWeight: '800',
    fontSize: 13,
  },
  dangerOutlineBtn: {
    backgroundColor: '#FEF2F2',
    borderColor: '#EF4444',
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
  },
  dangerOutlineText: {
    color: '#991B1B',
    fontWeight: '800',
    fontSize: 13,
  },
  disabled: {
    opacity: 0.6,
  },
  minuteContent: {
    fontSize: 13,
    color: '#1F2937',
    lineHeight: 20,
    backgroundColor: '#F9FAFB',
    padding: 12,
    borderRadius: 10,
  },
  minuteEditor: {
    minHeight: 180,
    backgroundColor: '#F9FAFB',
    borderColor: '#D1D5DB',
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    fontSize: 13,
    color: '#111827',
  },
  hashBox: {
    backgroundColor: '#F3F4F6',
    borderRadius: 8,
    padding: 8,
    gap: 2,
  },
  hashLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#4B5563',
  },
  hashValue: {
    fontFamily: 'monospace',
    fontSize: 10,
    color: '#111827',
  },
  signaturesBox: {
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
    paddingTop: 10,
    gap: 8,
  },
  subTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#111827',
  },
  signBtn: {
    flex: 1,
    backgroundColor: '#EFF6FF',
    borderColor: '#BFDBFE',
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
  },
  signBtnDone: {
    backgroundColor: '#DCFCE7',
    borderColor: '#16A34A',
  },
  signBtnText: {
    color: '#1D4ED8',
    fontWeight: '800',
    fontSize: 12,
  },
  signBtnTextDone: {
    color: '#166534',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 20,
    gap: 10,
  },
  modalTitle: {
    fontSize: 19,
    fontWeight: '900',
    color: '#111827',
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
    color: '#374151',
  },
  input: {
    backgroundColor: '#F9FAFB',
    borderColor: '#D1D5DB',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#111827',
  },
  multilineInput: {
    minHeight: 72,
    textAlignVertical: 'top',
  },
});
