// Page Assistant (P6 ; commande du menu « Assistant ») : la même conversation que la colonne de
// l'écran Actus, en pleine page, sans article ouvert : questions sur les données du terminal, chaque
// chiffre vérifié et sourcé (T-074). Pour une question sur un article, l'ouvrir dans Actus.

import '../news/news.css';
import { Link } from 'react-router-dom';
import { Chip } from '../../components/ui';
import { SubHeader } from '../../shell/SubHeader';
import { useNow } from '../../shell/useNow';
import { AssistantPanel } from '../news/AssistantPanel';

export function AssistantScreen() {
  const now = useNow(1000);
  return (
    <>
      <SubHeader icon="assistant" title="Assistant · questions sur les données du terminal"
        chips={<><Chip variant="hot" round>Chiffres vérifiés et sourcés</Chip><Link className="chip" to="/actus">Question sur un article : Actus</Link></>} />
      <div className="content as-page" data-screen="assistant">
        <div className="col" style={{ flex: '1 1 560px', maxWidth: 900 }}><AssistantPanel article={null} now={now} /></div>
      </div>
    </>
  );
}
