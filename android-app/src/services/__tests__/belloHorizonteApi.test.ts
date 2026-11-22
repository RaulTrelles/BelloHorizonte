const mockRpc = jest.fn();
const mockFrom = jest.fn();
const mockSignOut = jest.fn();

jest.mock('react-native', () => ({
  Platform: { OS: 'android', constants: { Brand: 'OPPO', Model: 'CPH2525' } },
  Linking: { openURL: jest.fn().mockResolvedValue(undefined) },
}));

jest.mock('../supabaseClient', () => ({
  getSupabaseClient: () => ({
    rpc: mockRpc,
    from: mockFrom,
    auth: {
      signOut: mockSignOut,
    },
  }),
}));

import {
  acknowledgeAlert,
  ADMIN_PROFILES_SAFE_COLUMNS,
  buildInviteWhatsAppText,
  buildPanicAlertWhatsAppText,
  buildWhatsAppShareUrl,
  closePanicAlert,
  CooldownActiveError,
  createPanicAlert,
  deleteMyAccount,
  getGroupInviteCode,
  GROUPS_SAFE_COLUMNS,
  isCooldownError,
  PROFILES_SAFE_COLUMNS,
  regenerateGroupInviteCode,
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

  it('construye enlaces wa.me válidos para alertas e invitaciones', () => {
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
    expect(alertText).toContain('105');

    const inviteText = buildInviteWhatsAppText({
      groupName: 'Asociación Bello Horizonte',
      inviteCode: 'BH-2026',
    });
    expect(inviteText).toContain('BH-2026');
  });
});
