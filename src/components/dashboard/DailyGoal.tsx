import Card from '../ui/Card';
import { StarIcon } from '../icons';

interface DailyGoalProps {
    dailyGoal: {
        meta: number;
        realizadasHoje: number;
        color: string;
        status: string;
    };
}

const DailyGoal = ({ dailyGoal }: DailyGoalProps) => (
    <Card className="flex flex-wrap justify-between items-center bg-sky-800/50 ring-1 ring-[#4ac7f0] print-break-inside-avoid">
        <div className="flex items-center gap-2">
            <StarIcon />
            <h3 className="font-bold">Meta Diária (Cenário Ideal)</h3>
        </div>
        <div className={`text-center p-2 rounded-lg ${dailyGoal.color.replace('text-', 'bg-').replace(']', ']/20')}`}>
            <span className={`font-bold text-2xl ${dailyGoal.color}`}>{dailyGoal.realizadasHoje} / {dailyGoal.meta.toFixed(1)}</span>
            <span className="text-sm ml-2">({dailyGoal.status})</span>
        </div>
    </Card>
);

export default DailyGoal;