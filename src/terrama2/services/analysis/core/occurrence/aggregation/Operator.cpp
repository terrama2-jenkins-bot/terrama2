/*
  Copyright (C) 2007 National Institute For Space Research (INPE) - Brazil.

  This file is part of TerraMA2 - a free and open source computational
  platform for analysis, monitoring, and alert of geo-environmental extremes.

  TerraMA2 is free software: you can redistribute it and/or modify
  it under the terms of the GNU Lesser General Public License as published by
  the Free Software Foundation, either version 3 of the License,
  or (at your option) any later version.

  TerraMA2 is distributed in the hope that it will be useful,
  but WITHOUT ANY WARRANTY; without even the implied warranty of
  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
  GNU Lesser General Public License for more details.

  You should have received a copy of the GNU Lesser General Public License
  along with TerraMA2. See LICENSE. If not, write to
  TerraMA2 Team at <terrama2-team@dpi.inpe.br>.
*/

/*!
  \file terrama2/services/analysis/core/occurrence/aggregation/Operator.cpp

  \brief Contains occurrence aggregation analysis operators.

  \author Paulo R. M. Oliveira
*/



#include "Operator.hpp"
#include "../Operator.hpp"


int terrama2::services::analysis::core::occurrence::aggregation::count(const std::string& dataSeriesName, Buffer buffer,
    const std::string& dateFilter,
    Buffer aggregationBuffer,
    const std::string& restriction)
{
  return (int) terrama2::services::analysis::core::occurrence::operatorImpl(StatisticOperation::COUNT, dataSeriesName, buffer, dateFilter, aggregationBuffer, "", StatisticOperation::COUNT, restriction);
}

double terrama2::services::analysis::core::occurrence::aggregation::min(const std::string& dataSeriesName, Buffer buffer, const std::string& dateFilter,
    const std::string& attribute, StatisticOperation aggregationStatisticOperation,
    Buffer aggregationBuffer, const std::string& restriction)
{
  return terrama2::services::analysis::core::occurrence::operatorImpl(StatisticOperation::MIN, dataSeriesName, buffer, dateFilter, aggregationBuffer, attribute,
         aggregationStatisticOperation, restriction);
}

double terrama2::services::analysis::core::occurrence::aggregation::max(const std::string& dataSeriesName, Buffer buffer, const std::string& dateFilter,
    const std::string& attribute, StatisticOperation aggregationStatisticOperation,
    Buffer aggregationBuffer, const std::string& restriction)
{
  return terrama2::services::analysis::core::occurrence::operatorImpl(StatisticOperation::MAX, dataSeriesName, buffer, dateFilter, aggregationBuffer, attribute,
         aggregationStatisticOperation, restriction);
}

double terrama2::services::analysis::core::occurrence::aggregation::mean(const std::string& dataSeriesName, Buffer buffer, const std::string& dateFilter,
    const std::string& attribute, StatisticOperation aggregationStatisticOperation,
    Buffer aggregationBuffer, const std::string& restriction)
{
  return terrama2::services::analysis::core::occurrence::operatorImpl(StatisticOperation::MEAN, dataSeriesName, buffer, dateFilter, aggregationBuffer, attribute,
         aggregationStatisticOperation, restriction);
}

double terrama2::services::analysis::core::occurrence::aggregation::median(const std::string& dataSeriesName, Buffer buffer, const std::string& dateFilter,
    const std::string& attribute, StatisticOperation aggregationStatisticOperation,
    Buffer aggregationBuffer, const std::string& restriction)
{
  return terrama2::services::analysis::core::occurrence::operatorImpl(StatisticOperation::MEDIAN, dataSeriesName, buffer, dateFilter, aggregationBuffer, attribute,
         aggregationStatisticOperation, restriction);
}

double terrama2::services::analysis::core::occurrence::aggregation::sum(const std::string& dataSeriesName, Buffer buffer, const std::string& dateFilter,
    const std::string& attribute, StatisticOperation aggregationStatisticOperation,
    Buffer aggregationBuffer, const std::string& restriction)
{
  return terrama2::services::analysis::core::occurrence::operatorImpl(StatisticOperation::SUM, dataSeriesName, buffer, dateFilter, aggregationBuffer, attribute,
         aggregationStatisticOperation, restriction);
}

double terrama2::services::analysis::core::occurrence::aggregation::standardDeviation(const std::string& dataSeriesName, Buffer buffer,
    const std::string& dateFilter, const std::string& attribute,
    StatisticOperation aggregationStatisticOperation,
    Buffer aggregationBuffer, const std::string& restriction)
{
  return terrama2::services::analysis::core::occurrence::operatorImpl(StatisticOperation::STANDARD_DEVIATION, dataSeriesName, buffer, dateFilter, aggregationBuffer, attribute,
         aggregationStatisticOperation, restriction);
}

double terrama2::services::analysis::core::occurrence::aggregation::variance(const std::string& dataSeriesName, Buffer buffer,
    const std::string& dateFilter, const std::string& attribute,
    StatisticOperation aggregationStatisticOperation,
    Buffer aggregationBuffer, const std::string& restriction)
{
  return terrama2::services::analysis::core::occurrence::operatorImpl(StatisticOperation::VARIANCE, dataSeriesName, buffer, dateFilter, aggregationBuffer, attribute,
         aggregationStatisticOperation, restriction);
}
