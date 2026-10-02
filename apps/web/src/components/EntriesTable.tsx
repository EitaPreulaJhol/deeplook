import {
  DataTable,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from '@carbon/react';
import { useNavigate } from 'react-router-dom';

import type { Entry } from '../api/types';
import { StatusTag, TypeTag, VerdictTag } from './tags';

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR');
}

export function EntriesTable({
  entries,
  showOwner = true,
}: {
  entries: Entry[];
  showOwner?: boolean;
}) {
  const navigate = useNavigate();
  const byId = new Map(entries.map((e) => [e.id, e]));

  const headers = [
    { key: 'title', header: 'Amostra' },
    { key: 'type', header: 'Tipo' },
    ...(showOwner ? [{ key: 'owner', header: 'Enviado por' }] : []),
    { key: 'status', header: 'Status' },
    { key: 'verdict', header: 'Veredito' },
    { key: 'reports', header: 'Relatórios' },
    { key: 'createdAt', header: 'Data' },
  ];

  const rows = entries.map((e) => ({ id: e.id }));

  return (
    <DataTable rows={rows} headers={headers}>
      {({ rows, headers, getTableProps, getHeaderProps, getRowProps }) => (
        <TableContainer>
          <Table {...getTableProps()} size="lg">
            <TableHead>
              <TableRow>
                {headers.map((header) => (
                  <TableHeader {...getHeaderProps({ header })} key={header.key}>
                    {header.header}
                  </TableHeader>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row) => {
                const entry = byId.get(row.id) as Entry;
                return (
                  <TableRow
                    {...getRowProps({ row })}
                    key={row.id}
                    onClick={() => navigate(`/entries/${entry.id}`)}
                    style={{ cursor: 'pointer' }}
                  >
                    <TableCell>{entry.title}</TableCell>
                    <TableCell>
                      <TypeTag type={entry.type} />
                    </TableCell>
                    {showOwner && <TableCell>{entry.owner.displayName}</TableCell>}
                    <TableCell>
                      <StatusTag status={entry.status} />
                    </TableCell>
                    <TableCell>
                      <VerdictTag verdict={entry.verdict} />
                    </TableCell>
                    <TableCell>
                      {entry._count ? entry._count.reports : (entry.reports?.length ?? 0)}
                    </TableCell>
                    <TableCell>{fmtDate(entry.createdAt)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </DataTable>
  );
}
