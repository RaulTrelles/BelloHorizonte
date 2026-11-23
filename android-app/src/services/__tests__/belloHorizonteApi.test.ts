const mockRpc = jest.fn();
const mockFrom = jest.fn();
const mockFunctionsInvoke = jest.fn();
const mockSignOut = jest.fn();
const mockSignInWithOAuth = jest.fn();
const mockExchangeCodeForSession = jest.fn();
const mockSetSession = jest.fn();
const mockOpenAuthSessionAsync = jest.fn();

jest.mock('react-native', () => ({
  Platform: { OS: 'android', constants: { Brand: 'OPPO', Model: 'CPH2525' } },
  Linking: { openURL: jest.fn().mockResolvedValue(undefined) },
}));

jest.mock('expo-web-browser', () => ({
  openAuthSessionAsync: (...args: unknown[]) => mockOpenAuthSessionAsync(...args),
}));

jest.mock('../supabaseClient', () => ({
  getSupabaseClient: () => ({
    rpc: mockRpc,
    from: mockFrom,
    functions: {
      invoke: mockFunctionsInvoke,
    },
    auth: {
      signOut: mockSignOut,
      signInWithOAuth: mockSignInWithOAuth,
      exchangeCodeForSession: mockExchangeCodeForSession,
      setSession: mockSetSession,
    },
  }),
}));

import {
  acknowledgeAlert,
  ADMIN_PROFILES_SAFE_COLUMNS,
  buildInviteWhatsAppText,
  buildMeetingChunkStoragePath,
  buildPanicAlertWhatsAppText,
  buildWhatsAppShareUrl,
  canManageMeetings,
  canUseAdminTestControls,
  closePanicAlert,
  confirmMinuteByRole,
  CooldownActiveError,
  createPanicAlert,
  deleteMyAccount,
  extractOAuthCallbackParams,
  generateOfficialMinutePdf,
  getGroupInviteCode,
  getPublicMinutePdfUrl,
  GROUPS_SAFE_COLUMNS,
  isCooldownError,
  isMinuteFullyApproved,
  isSyntheticPhoneEmail,
  normalizePeruPhoneDigits,
  OAUTH_REDIRECT_URI,
  PROFILES_SAFE_COLUMNS,
  regenerateGroupInviteCode,
  resolveAuthEmail,
  signInWithGoogle,
  updateMyFcmToken,
} from '../belloHorizonteApi';

describe('belloHorizonteApi', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSignOut.mockResolvedValue({ error: null });
  });

  it('respeta las columnas seguras RLS (sin codigo en groups ni fcm_token en profiles)', () => {
    expect(GROUPS_SAFE_COLUMNS).not.toContain('codigo');
    expect(PROFILES_SAFE_COLUMNS).not.toContain('fcm_token');
    expect(ADMIN_PROFILES_SAFE_COLUMNS).not.toContain('fcm_token');
  });

  it('restringe controles de prueba/simulación estrictamente a rol admin (BH-025)', () => {
    expect(canUseAdminTestControls('admin')).toBe(true);
    expect(canUseAdminTestControls('miembro')).toBe(false);
    expect(canUseAdminTestControls('presidente')).toBe(false);
    expect(canUseAdminTestControls('secretario')).toBe(false);
    expect(canUseAdminTestControls(null)).toBe(false);
    expect(canUseAdminTestControls(undefined)).toBe(false);
  });

  it('permite gestionar y grabar reuniones solo a directiva (admin, presidente, secretario)', () => {
    expect(canManageMeetings('admin')).toBe(true);
    expect(canManageMeetings('presidente')).toBe(true);
    expect(canManageMeetings('secretario')).toBe(true);
    expect(canManageMeetings('miembro')).toBe(false);
    expect(canManageMeetings(null)).toBe(false);
    expect(canManageMeetings(undefined)).toBe(false);

    expect(buildMeetingChunkStoragePath('grp-1', 'mtg-9', 1)).toBe('grp-1/mtg-9/chunk_001.m4a');
    expect(buildMeetingChunkStoragePath('grp-1', 'mtg-9', 12)).toBe('grp-1/mtg-9/chunk_012.m4a');
  });

  it('actualiza fcm_token exclusivamente mediante RPC update_my_fcm_token', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: null });

    await updateMyFcmToken('fcm-token-abc', 'OPPO CPH2525');

    expect(mockRpc).toHaveBeenCalledWith('update_my_fcm_token', {
      p_fcm_token: 'fcm-token-abc',
      p_device_brand: 'OPPO CPH2525',
    });
  });

  it('mapea COOLDOWN_ACTIVE a CooldownActiveError al insertar alerta', async () => {
    const singleMock = jest.fn().mockResolvedValueOnce({
      data: null,
      error: { message: 'COOLDOWN_ACTIVE: Espera 2 minutos antes de enviar otra alerta' },
    });
    const selectMock = jest.fn().mockReturnValue({ single: singleMock });
    const insertMock = jest.fn().mockReturnValue({ select: selectMock });
    mockFrom.mockReturnValueOnce({ insert: insertMock });

    await expect(
      createPanicAlert({
        groupId: 'group-1',
        userId: 'user-1',
      })
    ).rejects.toThrow(CooldownActiveError);

    expect(isCooldownError(new CooldownActiveError())).toBe(true);
  });

  it('ignora error de duplicado 23505 en acknowledgeAlert', async () => {
    const insertMock = jest.fn().mockResolvedValueOnce({
      error: { code: '23505', message: 'duplicate key value' },
    });
    mockFrom.mockReturnValueOnce({ insert: insertMock });

    await expect(acknowledgeAlert('alert-1', 'user-1', 'enterado')).resolves.toBeUndefined();
  });

  it('actualiza solo el campo estado al cerrar alerta (resuelta / falsa_alarma)', async () => {
    const singleMock = jest.fn().mockResolvedValueOnce({
      data: { id: 'alert-1', estado: 'falsa_alarma' },
      error: null,
    });
    const selectMock = jest.fn().mockReturnValue({ single: singleMock });
    const eqMock = jest.fn().mockReturnValue({ select: selectMock });
    const updateMock = jest.fn().mockReturnValue({ eq: eqMock });
    mockFrom.mockReturnValueOnce({ update: updateMock });

    await closePanicAlert('alert-1', 'falsa_alarma');

    expect(updateMock).toHaveBeenCalledWith({ estado: 'falsa_alarma' });
  });

  it('invoca RPCs exactas para código de invitación y eliminación de cuenta (Ley 29733)', async () => {
    mockRpc
      .mockResolvedValueOnce({ data: 'BH-2026', error: null })
      .mockResolvedValueOnce({ data: 'BH-99AA11', error: null })
      .mockResolvedValueOnce({ data: null, error: null });

    const code = await getGroupInviteCode('group-1');
    const newCode = await regenerateGroupInviteCode('group-1');
    await deleteMyAccount();

    expect(code).toBe('BH-2026');
    expect(newCode).toBe('BH-99AA11');
    expect(mockRpc).toHaveBeenNthCalledWith(1, 'get_group_invite_code', { p_group_id: 'group-1' });
    expect(mockRpc).toHaveBeenNthCalledWith(2, 'regenerate_group_code', { p_group_id: 'group-1' });
    expect(mockRpc).toHaveBeenNthCalledWith(3, 'delete_my_account');
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });

  it('construye enlaces wa.me válidos y omite ubicación si lat/lng están vacíos', () => {
    const alertText = buildPanicAlertWhatsAppText({
      groupName: 'Asociación Bello Horizonte',
      senderName: 'María Pérez',
      timeLabel: '22:15',
      lat: -12.0464,
      lng: -77.0428,
    });
    const url = buildWhatsAppShareUrl(alertText);
    expect(url.startsWith('https://wa.me/?text=')).toBe(true);
    expect(alertText).toContain('¡ALERTA! Robo en la cuadra – María Pérez avisó a las 22:15');
    expect(alertText).toContain('google.com/maps');
    expect(alertText).toContain('105');

    const blankCoordsText = buildPanicAlertWhatsAppText({
      groupName: 'Asociación Bello Horizonte',
      senderName: 'María Pérez',
      timeLabel: '22:15',
      lat: '   ',
      lng: '',
    });
    expect(blankCoordsText).not.toContain('google.com/maps');

    const inviteText = buildInviteWhatsAppText({
      groupName: 'Asociación Bello Horizonte',
      inviteCode: 'BH-2026',
    });
    expect(inviteText).toContain('BH-2026');
  });

  it('signInWithGoogle intercambia code PKCE por sesión correctamente (BH-026)', async () => {
    mockSignInWithOAuth.mockResolvedValueOnce({
      data: { url: 'https://supabase.co/auth/v1/authorize?provider=google' },
      error: null,
    });
    mockOpenAuthSessionAsync.mockResolvedValueOnce({
      type: 'success',
      url: `${OAUTH_REDIRECT_URI}?code=pkce-code-123`,
    });
    const fakeSession = { access_token: 'tok', user: { id: 'u-1' } };
    mockExchangeCodeForSession.mockResolvedValueOnce({
      data: { session: fakeSession },
      error: null,
    });

    const res = await signInWithGoogle();

    expect(mockSignInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: {
        redirectTo: OAUTH_REDIRECT_URI,
        skipBrowserRedirect: true,
      },
    });
    expect(mockOpenAuthSessionAsync).toHaveBeenCalledWith(
      'https://supabase.co/auth/v1/authorize?provider=google',
      OAUTH_REDIRECT_URI
    );
    expect(mockExchangeCodeForSession).toHaveBeenCalledWith('pkce-code-123');
    expect(res).toEqual({ cancelled: false, session: fakeSession });
  });

  it('signInWithGoogle soporta fallback con #access_token y #refresh_token y cancelación', async () => {
    // 1. Fallback implícito
    mockSignInWithOAuth.mockResolvedValueOnce({
      data: { url: 'https://supabase.co/auth/v1/authorize?provider=google' },
      error: null,
    });
    mockOpenAuthSessionAsync.mockResolvedValueOnce({
      type: 'success',
      url: `${OAUTH_REDIRECT_URI}#access_token=acc-1&refresh_token=ref-2`,
    });
    const fakeSession = { access_token: 'acc-1', user: { id: 'u-2' } };
    mockSetSession.mockResolvedValueOnce({
      data: { session: fakeSession },
      error: null,
    });

    const fallbackRes = await signInWithGoogle();
    expect(mockSetSession).toHaveBeenCalledWith({
      access_token: 'acc-1',
      refresh_token: 'ref-2',
    });
    expect(fallbackRes).toEqual({ cancelled: false, session: fakeSession });

    // 2. Cancelación por el usuario
    mockSignInWithOAuth.mockResolvedValueOnce({
      data: { url: 'https://supabase.co/auth/v1/authorize?provider=google' },
      error: null,
    });
    mockOpenAuthSessionAsync.mockResolvedValueOnce({ type: 'cancel' });

    const cancelRes = await signInWithGoogle();
    expect(cancelRes).toEqual({ cancelled: true, session: null });

    // 3. Parser de callback
    expect(extractOAuthCallbackParams(`${OAUTH_REDIRECT_URI}?error_description=access_denied`)).toEqual({
      code: undefined,
      accessToken: undefined,
      refreshToken: undefined,
      errorDescription: 'access_denied',
    });
  });

  it('valida doble confirmación directiva (isMinuteFullyApproved) y URL pública de PDF', () => {
    expect(isMinuteFullyApproved(null)).toBe(false);
    expect(
      isMinuteFullyApproved({
        aprobada_presidente_at: '2026-11-23T15:00:00Z',
        aprobada_secretario_at: null,
      })
    ).toBe(false);
    expect(
      isMinuteFullyApproved({
        aprobada_presidente_at: null,
        aprobada_secretario_at: '2026-11-23T15:05:00Z',
      })
    ).toBe(false);
    expect(
      isMinuteFullyApproved({
        aprobada_presidente_at: '2026-11-23T15:00:00Z',
        aprobada_secretario_at: '2026-11-23T15:05:00Z',
      })
    ).toBe(true);

    expect(
      getPublicMinutePdfUrl('/grp-1/mtg-1/acta.pdf', 'https://znvzcfllibajvmmjtsct.supabase.co/')
    ).toBe(
      'https://znvzcfllibajvmmjtsct.supabase.co/storage/v1/object/public/meeting-minutes-pdf/grp-1/mtg-1/acta.pdf'
    );
    expect(getPublicMinutePdfUrl('', 'https://znvzcfllibajvmmjtsct.supabase.co')).toBe('');
  });

  it('invoca confirm_minute_by_role y generate_pdf correctamente', async () => {
    mockRpc.mockResolvedValueOnce({ data: { id: 'min-1' }, error: null });
    await confirmMinuteByRole('min-1', 'presidente');
    expect(mockRpc).toHaveBeenCalledWith('confirm_minute_by_role', {
      p_minute_id: 'min-1',
      p_as_role: 'presidente',
    });

    mockFunctionsInvoke.mockResolvedValueOnce({
      data: {
        pdfPath: 'grp-1/mtg-1/acta.pdf',
        pdfUrl: 'https://example.supabase.co/storage/v1/object/public/meeting-minutes-pdf/grp-1/mtg-1/acta.pdf',
        whatsappText: 'Acta lista',
        whatsappShareUrl: 'https://wa.me/?text=Acta%20lista',
      },
      error: null,
    });
    const pdfRes = await generateOfficialMinutePdf('mtg-1');
    expect(mockFunctionsInvoke).toHaveBeenCalledWith('generate-meeting-minute', {
      body: {
        meetingId: 'mtg-1',
        action: 'generate_pdf',
      },
    });
    expect(pdfRes.whatsappShareUrl).toBe('https://wa.me/?text=Acta%20lista');
  });

  it('normaliza celulares de Perú y resuelve correos sintéticos sin SMS', () => {
    expect(normalizePeruPhoneDigits('987654321')).toBe('51987654321');
    expect(normalizePeruPhoneDigits('+51 987 654 321')).toBe('51987654321');
    expect(normalizePeruPhoneDigits('+51 987-654-321')).toBe('51987654321');
    expect(() => normalizePeruPhoneDigits('12345')).toThrow();

    expect(resolveAuthEmail('Vecino@Correo.com ')).toBe('vecino@correo.com');
    expect(resolveAuthEmail('987654321')).toBe('51987654321@vecino.bellohorizonte.pe');
    expect(resolveAuthEmail('+51 987 654 321')).toBe('51987654321@vecino.bellohorizonte.pe');

    expect(isSyntheticPhoneEmail('51987654321@vecino.bellohorizonte.pe')).toBe(true);
    expect(isSyntheticPhoneEmail('vecino@gmail.com')).toBe(false);
    expect(isSyntheticPhoneEmail(null)).toBe(false);
    expect(isSyntheticPhoneEmail(undefined)).toBe(false);
  });
});
