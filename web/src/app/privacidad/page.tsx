import type { Metadata } from "next";
import Link from "next/link";
import { ShieldCheck, ArrowLeft, Lock, Clock, Database } from "lucide-react";
import { DeleteAccountSection } from "@/components/DeleteAccountSection";

export const metadata: Metadata = {
  title: "Política de Privacidad y Eliminación de Cuenta",
  description:
    "Política de Privacidad y tratamiento de datos personales de la Asociación Bello Horizonte conforme a la Ley N.° 29733 (Perú) y requisitos de Google Play.",
};

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 transition hover:text-brand-900"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Volver al Portal Principal
      </Link>

      <header className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-brand-800">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
          Ley N.° 29733 (Perú) · Google Play
        </span>
        <h1 className="mt-3 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
          Política de Privacidad y Eliminación de Cuenta
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-600">
          Aplicación Móvil <strong>Alarma Vecinal Bello Horizonte</strong> y
          Portal Web Oficial de la <strong>Asociación Bello Horizonte</strong>{" "}
          (Perú). Última actualización: noviembre de 2026.
        </p>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl bg-slate-50 p-3.5 text-xs text-slate-700">
            <Lock className="h-4 w-4 text-brand-700" aria-hidden="true" />
            <p className="mt-1.5 font-semibold text-slate-900">
              Cero venta de datos
            </p>
            <p className="mt-0.5 text-slate-600">
              Nunca vendemos ni compartimos tus datos con anunciantes ni
              terceros.
            </p>
          </div>
          <div className="rounded-xl bg-slate-50 p-3.5 text-xs text-slate-700">
            <Database className="h-4 w-4 text-brand-700" aria-hidden="true" />
            <p className="mt-1.5 font-semibold text-slate-900">
              Ubicación solo al alertar
            </p>
            <p className="mt-0.5 text-slate-600">
              No rastreamos tu ubicación en segundo plano; solo se envía al
              disparar una alerta.
            </p>
          </div>
          <div className="rounded-xl bg-slate-50 p-3.5 text-xs text-slate-700">
            <Clock className="h-4 w-4 text-brand-700" aria-hidden="true" />
            <p className="mt-1.5 font-semibold text-slate-900">
              Retención máxima 90 días
            </p>
            <p className="mt-0.5 text-slate-600">
              El historial de alertas se depura automáticamente tras 90 días.
            </p>
          </div>
        </div>
      </header>

      <article className="mt-8 space-y-8 rounded-2xl border border-slate-200 bg-white p-6 text-sm leading-relaxed text-slate-700 shadow-sm sm:p-8">
        <section>
          <h2 className="text-xl font-bold text-slate-900">
            1. Responsable del tratamiento de datos
          </h2>
          <p className="mt-2">
            La <strong>Asociación Bello Horizonte</strong> (Perú) es
            responsable del tratamiento de los datos personales recopilados a
            través de la aplicación móvil Android{" "}
            <em>Alarma Vecinal Bello Horizonte</em> y el presente portal web, en
            estricto cumplimiento de la{" "}
            <strong>
              Ley N.° 29733 — Ley de Protección de Datos Personales del Perú
            </strong>{" "}
            y su Reglamento (D.S. N.° 003-2013-JUS).
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-slate-900">
            2. Datos personales que recopilamos (principio de minimización)
          </h2>
          <p className="mt-2">
            Recopilamos únicamente los datos estrictamente necesarios para
            operar la red de seguridad vecinal:
          </p>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li>
              <strong>Datos de identificación y contacto:</strong> nombre
              completo, correo electrónico de acceso, número de teléfono móvil
              en formato Perú (<code>+51</code>) y, de forma opcional, tu
              dirección o número de lote dentro de la asociación.
            </li>
            <li>
              <strong>Ubicación aproximada/precisa únicamente al alertar:</strong>{" "}
              las coordenadas GPS (<code>lat</code>, <code>lng</code>) se
              capturan <strong>únicamente</strong> en el instante en que un
              vecino confirma el envío de una alerta de pánico y siempre que
              haya otorgado permiso de ubicación. La app{" "}
              <strong>no realiza seguimiento continuo</strong> ni rastreo en
              segundo plano.
            </li>
            <li>
              <strong>Datos técnicos del dispositivo:</strong> token de
              notificaciones push (Firebase Cloud Messaging) y marca del equipo
              Android, usados exclusivamente para entregar la alerta sonora en
              tiempo real y orientar los permisos de batería. El token FCM no se
              expone a otros vecinos.
            </li>
            <li>
              <strong>Registro de consentimiento:</strong> fecha y hora en que
              aceptaste esta política al unirte al grupo.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-bold text-slate-900">
            3. Finalidad exclusiva del tratamiento
          </h2>
          <p className="mt-2">
            Tus datos personales se utilizan <strong>exclusivamente</strong>{" "}
            para:
          </p>
          <ul className="mt-3 list-disc space-y-1.5 pl-5">
            <li>
              Validar tu pertenencia a la Asociación Bello Horizonte mediante
              aprobación de los administradores de la directiva.
            </li>
            <li>
              Disparar y recibir alertas de emergencia comunitaria (&ldquo;Robo
              en la cuadra&rdquo;), mostrando el nombre del vecino emisor (sin
              anonimato) para prevenir falsas alarmas y coordinar auxilio.
            </li>
            <li>
              Registrar confirmaciones de lectura (&ldquo;Estoy enterado&rdquo;)
              y detener remotamente la sirena cuando la alerta es marcada como
              resuelta o falsa alarma.
            </li>
            <li>
              Informar comunicados oficiales de la asociación vecinal.
            </li>
          </ul>
          <p className="mt-3 rounded-xl bg-slate-50 p-3.5 text-xs text-slate-600">
            <strong>Aviso importante:</strong> Esta plataforma es un sistema de
            apoyo comunitario y <strong>no sustituye</strong> a la Policía
            Nacional del Perú (105), Serenazgo, Bomberos (116) ni SAMU (106).
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-slate-900">
            4. No venta de datos y encargados de infraestructura
          </h2>
          <p className="mt-2">
            La Asociación Bello Horizonte{" "}
            <strong>no vende, alquila ni cede</strong> datos personales a
            terceros con fines publicitarios, comerciales ni de perfilamiento.
            Para el funcionamiento técnico de la plataforma utilizamos
            proveedores de infraestructura bajo estrictos controles de seguridad
            y cifrado en tránsito (HTTPS/TLS) y en reposo:
          </p>
          <ul className="mt-3 list-disc space-y-1.5 pl-5">
            <li>
              <strong>Supabase</strong> (autenticación, base de datos PostgreSQL
              con políticas de seguridad a nivel de fila — RLS — y funciones de
              servidor).
            </li>
            <li>
              <strong>Firebase Cloud Messaging (Google)</strong> únicamente como
              canal de transporte para entregar notificaciones de alta prioridad
              a los dispositivos Android registrados.
            </li>
            <li>
              <strong>Vercel</strong> para el alojamiento del portal web público
              y panel administrativo.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-bold text-slate-900">
            5. Plazo de conservación y retención limitada (90 días)
          </h2>
          <p className="mt-2">
            El historial de alertas de pánico (incluyendo coordenadas de la
            alerta y confirmaciones de vecinos) se conserva por un plazo máximo
            de <strong>90 días calendario</strong>, tras lo cual es eliminado
            automáticamente de la base de datos mediante tareas programadas de
            depuración. Los datos de tu perfil y membresía se conservan mientras
            mantengas tu cuenta activa en la asociación o hasta que solicites
            su eliminación.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-slate-900">
            6. Seguridad de la información
          </h2>
          <p className="mt-2">
            Todas las tablas de la base de datos cuentan con{" "}
            <strong>Row Level Security (RLS)</strong> estricto: los vecinos solo
            pueden consultar alertas de su propio grupo cuando su membresía está
            aprobada y activa, el código de invitación solo es accesible por
            administradores autorizados y los tokens push del dispositivo no son
            legibles desde clientes web ni móviles.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-slate-900">
            7. Derechos ARCO y Eliminación de Cuenta
          </h2>
          <p className="mt-2">
            Conforme a la Ley N.° 29733, tienes derecho en cualquier momento a
            ejercer tus derechos de{" "}
            <strong>
              Acceso, Rectificación, Cancelación y Oposición (ARCO)
            </strong>{" "}
            así como a revocar tu consentimiento y eliminar definitivamente tu
            cuenta y todos los datos asociados.
          </p>
          <p className="mt-2">
            Puedes ejecutar la eliminación de tu cuenta directamente desde la
            sección inferior de esta página (o desde la opción equivalente en la
            app Android), o bien solicitarla presencialmente o por escrito ante
            la directiva de la Asociación Bello Horizonte, la cual atenderá tu
            solicitud en los plazos legales vigentes.
          </p>
        </section>

        <section id="eliminar-cuenta" className="scroll-mt-24 pt-2">
          <DeleteAccountSection />
        </section>
      </article>
    </div>
  );
}
