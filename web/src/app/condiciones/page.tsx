import type { Metadata } from "next";
import Link from "next/link";
import { ShieldAlert, FileText, ArrowLeft, Scale } from "lucide-react";

export const metadata: Metadata = {
  title: "Condiciones del Servicio — Asociación Bello Horizonte",
  description:
    "Términos y condiciones de uso del Portal Web y la App Android de Alarma Comunitaria de Asociación Bello Horizonte (Perú).",
};

export default function CondicionesPage() {
  return (
    <main className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:text-brand-800"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Volver al inicio
      </Link>

      <header className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="flex items-center gap-3 text-brand-700">
          <Scale className="h-7 w-7" aria-hidden="true" />
          <span className="text-xs font-semibold uppercase tracking-wider">
            Marco Legal y Uso Comunitario · Perú
          </span>
        </div>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">
          Condiciones del Servicio
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          Asociación Bello Horizonte · Última actualización: Noviembre 2026
        </p>
      </header>

      <div className="mt-8 space-y-6 text-sm leading-relaxed text-slate-700">
        <section className="rounded-xl border border-amber-200 bg-amber-50 p-5">
          <div className="flex items-start gap-3">
            <ShieldAlert
              className="mt-0.5 h-5 w-5 shrink-0 text-amber-700"
              aria-hidden="true"
            />
            <div>
              <h2 className="font-semibold text-amber-950">
                1. Naturaleza del servicio (no sustituye a la Policía ni
                emergencias)
              </h2>
              <p className="mt-1 text-amber-900">
                El Portal Web y la aplicación Android{" "}
                <strong>Asociación Bello Horizonte</strong> son herramientas
                tecnológicas de apoyo y coordinación vecinal.{" "}
                <strong>
                  No sustituyen en ningún caso a la Policía Nacional del Perú
                  (105), Serenazgo, Bomberos (116) ni SAMU (106).
                </strong>{" "}
                Ante cualquier delito o emergencia real, el usuario debe
                comunicarse de inmediato con las autoridades competentes.
              </p>
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">
            2. Acceso, registro y aprobación de miembros
          </h2>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li>
              El acceso a la red de alertas comunitarias está reservado a
              vecinos y miembros verificados de la Asociación Bello Horizonte
              mediante código de invitación y aprobación explícita de la
              administración (Directiva).
            </li>
            <li>
              El usuario se compromete a proporcionar datos reales (nombre
              completo y número telefónico) y a mantener la confidencialidad de
              sus credenciales y del código de invitación del grupo.
            </li>
          </ul>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">
            3. Uso responsable del Botón de Pánico y medidas anti-abuso
          </h2>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li>
              El Botón de Pánico debe utilizarse únicamente ante situaciones de
              emergencia real en la cuadra o asociación.
            </li>
            <li>
              Para prevenir abusos y falsas alarmas, toda alerta registra y
              muestra la <strong>identidad del emisor (sin anonimato)</strong>,
              aplica un límite de frecuencia (1 alerta cada 2 minutos por
              usuario) y permite al emisor o administrador cancelar falsas
              alarmas.
            </li>
            <li>
              El uso indebido, bromas o disparos reiterados de falsas alarmas
              faculta a los administradores a{" "}
              <strong>suspender o revocar el acceso</strong> del usuario a la
              plataforma.
            </li>
          </ul>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">
            4. Requisitos técnicos y limitaciones del servicio
          </h2>
          <p className="mt-2">
            La entrega y reproducción oportuna de la alarma sonora en Android
            depende de factores externos como la conectividad a internet, el
            servicio Firebase Cloud Messaging (FCM), el nivel de batería y los
            permisos otorgados por el usuario en su dispositivo (notificaciones,
            pantalla completa y exclusión de ahorro de batería). La Asociación
            realiza esfuerzos razonables para mantener la disponibilidad, pero
            no garantiza entrega ininterrumpida en todos los equipos ni redes.
          </p>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">
            5. Privacidad, datos personales y eliminación de cuenta
          </h2>
          <p className="mt-2">
            El tratamiento de datos personales se rige por la{" "}
            <strong>Ley N.° 29733</strong> (Ley de Protección de Datos
            Personales del Perú) y nuestra{" "}
            <Link
              href="/privacidad"
              className="inline-flex items-center gap-1 font-medium text-brand-700 underline hover:text-brand-800"
            >
              <FileText className="h-3.5 w-3.5" aria-hidden="true" />
              Política de Privacidad
            </Link>
            , donde también puedes ejercer en cualquier momento tu derecho de
            eliminación inmediata de cuenta y datos asociados.
          </p>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">
            6. Modificaciones y contacto
          </h2>
          <p className="mt-2">
            La Directiva de la Asociación Bello Horizonte podrá actualizar estas
            Condiciones del Servicio cuando se incorporen nuevas funcionalidades
            (como módulos de reuniones y actas comunitarias), publicando siempre
            la versión vigente en esta misma dirección.
          </p>
        </section>
      </div>
    </main>
  );
}
