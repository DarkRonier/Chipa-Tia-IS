-- Usuarios borrados por el administrador: dejan de aparecer y de poder entrar, pero sus registros quedan en el
-- historial con su nombre. El nombre de usuario se libera para poder volver a usarlo.
ALTER TABLE usuarios ADD COLUMN borrado_en TEXT;
